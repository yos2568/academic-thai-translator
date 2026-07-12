import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/parsers";
import { chunkText } from "@/lib/chunker";
import { validateUpload, ValidationError, MAX_FILE_SIZE } from "@/lib/validation";
import { allowRequest, requestIp } from "@/lib/ratelimit";
import { captureDocumentImages, type CapturedDocumentImage } from "@/lib/document-images";
import { injectImageMarkers } from "@/lib/image-markers";

export const runtime = "nodejs";
export const maxDuration = 240;

interface ExtractionResult {
  text: string;
  images: CapturedDocumentImage[];
  meta: {
    filename: string;
    type: string;
    characters: number;
    chunkCount: number;
    ocr: boolean;
    imageCount: number;
    imageWarning?: string;
  };
}

type ProgressCallback = (percent: number, message: string) => void;

function preflight(request: NextRequest): NextResponse | null {
  const ip = requestIp(request);
  if (!allowRequest(`extract:${ip}`, { capacity: 10, refillPerMinute: 10 })) {
    return NextResponse.json(
      { error: "Too many extraction requests. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_SIZE + 4096) {
    return NextResponse.json(
      { error: `File is too large. The maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.` },
      { status: 413 }
    );
  }
  return null;
}

async function processUpload(
  request: NextRequest,
  onProgress: ProgressCallback
): Promise<ExtractionResult> {
  onProgress(3, "Receiving uploaded document…");
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ValidationError("Expected a multipart/form-data upload.");
  }

  onProgress(10, "Upload received. Validating file…");
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("No file was provided.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = validateUpload(file.name, buffer);
  onProgress(18, `Validated ${type.toUpperCase()} file.`);

  const extractionTimeout = AbortSignal.timeout(180_000);
  const signal = AbortSignal.any([request.signal, extractionTimeout]);
  const extraction = await extractText(
    type,
    buffer,
    signal,
    onProgress
  );
  const { text: rawText, ocr } = extraction;
  onProgress(92, "Capturing figures from the original document…");
  const imageCapture = await captureDocumentImages(type, buffer, signal, {
    pageCount: extraction.pageCount,
    pageParagraphCounts: extraction.pageParagraphCounts,
    totalParagraphs: rawText.split(/\n{2,}/).filter(Boolean).length,
    ocr,
  });
  // Embed [[IMG:id]] markers so figures stay aligned after translation.
  const text = injectImageMarkers(rawText, imageCapture.images, extraction.pageParagraphCounts);
  onProgress(96, "Preparing document preview…");
  const chunks = chunkText(text);

  return {
    text,
    images: imageCapture.images,
    meta: {
      filename: file.name,
      type,
      characters: text.length,
      chunkCount: chunks.length,
      ocr,
      imageCount: imageCapture.images.length,
      imageWarning: imageCapture.warning,
    },
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  console.error("extract failed:", error);
  return "Something went wrong while reading the file.";
}

function streamingResponse(request: NextRequest): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };
      try {
        const result = await processUpload(request, (percent, message) =>
          send({ type: "progress", percent, message })
        );
        send({ type: "progress", percent: 100, message: "Document ready." });
        send({ type: "result", data: result });
      } catch (error) {
        send({ type: "error", message: friendlyError(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      // request.signal is aborted by the runtime when the client disconnects;
      // child OCR processes receive that signal through processUpload.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  const rejected = preflight(request);
  if (rejected) return rejected;

  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return streamingResponse(request);
  }

  try {
    const result = await processUpload(request, () => undefined);
    return NextResponse.json(result);
  } catch (error) {
    const message = friendlyError(error);
    const status = error instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
