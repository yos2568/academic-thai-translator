/**
 * Paragraph-aware chunking. Grok-class models handle large contexts well;
 * larger chunks = fewer round-trips (major speed win on long handbooks).
 * Rough heuristic: ~4 chars per token → ~6k tokens at 24k chars.
 * Paragraphs are never split unless a single paragraph alone exceeds the limit.
 */
const MAX_CHUNK_CHARS = 24_000;

export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      // Oversized paragraph: flush, then split on sentence boundaries.
      push();
      let piece = "";
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if (piece.length + sentence.length + 1 > MAX_CHUNK_CHARS) {
          if (piece.trim()) chunks.push(piece.trim());
          piece = "";
        }
        piece += (piece ? " " : "") + sentence;
      }
      if (piece.trim()) chunks.push(piece.trim());
      continue;
    }

    if (current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      push();
    }
    current += (current ? "\n\n" : "") + paragraph;
  }
  push();

  return chunks;
}
