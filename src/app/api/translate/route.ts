import Anthropic from "@anthropic-ai/sdk";
import { chunkText } from "@/lib/chunker";
import { extractGlossaryTerms, formatGlossary } from "@/lib/glossary";
import { postEdit } from "@/lib/postedit/academic";
import { getPipelineConfig } from "@/lib/providers";
import { checkTranslation } from "@/lib/qa/checks";
import { translateChunk } from "@/lib/translator";
import { allowRequest, requestIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_INPUT_CHARS = 400_000;
const MAX_TRANSLATE_BODY_BYTES = 2_000_000;
const MAX_PINNED_GLOSSARY_TERMS = 100;

type SseEvent = { type: "progress" | "stage" | "delta" | "replace_chunk" | "qa" | "done" | "error"; [key: string]: unknown };

/** User-pinned terms, keyed like glossary.ts's auto-extracted entries so they merge into the same map. */
function parsePinnedGlossary(body: unknown): Map<string, string> {
  const glossary = new Map<string, string>();
  const items = (body as { pinnedGlossary?: unknown })?.pinnedGlossary;
  if (!Array.isArray(items)) return glossary;
  for (const item of items.slice(0, MAX_PINNED_GLOSSARY_TERMS)) {
    const english = typeof (item as { english?: unknown })?.english === "string" ? (item as { english: string }).english.trim() : "";
    const thai = typeof (item as { thai?: unknown })?.thai === "string" ? (item as { thai: string }).thai.trim() : "";
    if (english && thai) glossary.set(english.toLowerCase(), thai);
  }
  return glossary;
}

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!allowRequest(`translate:${ip}`, { capacity: 5, refillPerMinute: 1 })) {
    return Response.json({ error: "Too many translation requests. Please wait a minute and try again." }, { status: 429 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TRANSLATE_BODY_BYTES) {
    return Response.json({ error: "Translation request is too large." }, { status: 413 });
  }
  let text = "";
  let pinnedGlossary = new Map<string, string>();
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
    pinnedGlossary = parsePinnedGlossary(body);
  } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!text) return Response.json({ error: "No text to translate." }, { status: 400 });
  if (text.length > MAX_INPUT_CHARS) return Response.json({ error: "The document is too long." }, { status: 413 });

  let config;
  try { config = getPipelineConfig(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid provider configuration." }, { status: 400 }); }

  const chunks = chunkText(text);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // Fetches one chunk's draft. In "live" mode (only ever the very first
      // chunk, which has nothing to overlap with) deltas stream straight to
      // the client as they arrive, exactly like the old sequential code. In
      // background mode (every later chunk, prefetched while the previous
      // chunk's post-edit/QA is still running) deltas are buffered and
      // replayed as a burst once emission reaches that chunk's turn, so the
      // SSE event *order* stays strictly per-chunk-sequential even though
      // the underlying network calls overlap.
      const draftChunk = async (index: number, glossaryText: string, live: boolean) => {
        const deltas: string[] = [];
        const draft = await translateChunk({
          chunk: chunks[index],
          chunkIndex: index,
          totalChunks: chunks.length,
          glossary: glossaryText,
          config: config.draft,
          onDelta: (delta) => {
            if (live) send({ type: "delta", text: delta, chunk: index + 1 });
            else deltas.push(delta);
          },
        });
        return { draft, deltas };
      };

      try {
        // Seeded first so extractGlossaryTerms's "only add if absent" rule
        // (glossary.ts) keeps pinned translations from being overwritten.
        const glossary = new Map(pinnedGlossary);
        let pending: ReturnType<typeof draftChunk> | null = null;

        for (let i = 0; i < chunks.length; i++) {
          send({ type: "progress", chunk: i + 1, total: chunks.length });
          send({ type: "stage", stage: "draft", chunk: i + 1 });

          let draft: string;
          if (pending) {
            const result = await pending;
            draft = result.draft;
            for (const delta of result.deltas) send({ type: "delta", text: delta, chunk: i + 1 });
          } else {
            draft = (await draftChunk(i, formatGlossary(glossary), true)).draft;
          }

          // Harvest glossary terms visible in the raw draft now (the
          // translation prompt already asks for "term (English)" on first
          // occurrence), before kicking off the next chunk's draft. This is
          // what makes the overlap possible: the next draft only waits on
          // this chunk's draft output, not on this chunk's full post-edit +
          // QA pass. Consequence: chunk i+1's draft will not see any term
          // that only emerges during chunk i's post-edit polish — it only
          // sees terms from chunk i's raw draft plus all earlier chunks'
          // fully-extracted glossaries. extractGlossaryTerms never
          // overwrites an existing key, so this ordering never lets an
          // auto-extracted term clobber a pinned one.
          extractGlossaryTerms(draft, glossary);

          if (i + 1 < chunks.length) {
            const next = draftChunk(i + 1, formatGlossary(glossary), false);
            next.catch(() => {}); // swallow here; a real failure still surfaces via the `await pending` above (or the throw below stops the loop first)
            pending = next;
          } else {
            pending = null;
          }

          let final = draft;
          if (config.postedit) {
            send({ type: "stage", stage: "postedit", chunk: i + 1 });
            final = await postEdit(chunks[i], draft, formatGlossary(glossary), config.postedit);
            send({ type: "replace_chunk", text: final, chunk: i + 1 });
          }
          extractGlossaryTerms(final, glossary);
          send({ type: "stage", stage: "qa", chunk: i + 1 });
          send({ type: "qa", report: checkTranslation(chunks[i], final, i + 1) });
          if (i < chunks.length - 1) send({ type: "delta", text: "\n\n", chunk: i + 2 });
        }
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", message: friendlyError(error) });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

function friendlyError(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) return "The provider rejected the API key.";
  if (error instanceof Anthropic.RateLimitError) return "The provider is busy. Please try again shortly.";
  if (error instanceof Error && !/sk-|api.?key/i.test(error.message)) {
    return error.message.replace(/https?:\/\/\S+/g, "[redacted upstream]");
  }
  return "Translation failed. Check the provider settings and try again.";
}
