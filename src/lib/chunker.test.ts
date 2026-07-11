import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

const MAX_CHUNK_CHARS = 12_000;

describe("chunkText", () => {
  it("keeps a short document as a single chunk", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    expect(chunkText(text)).toEqual(["Paragraph one.\n\nParagraph two.\n\nParagraph three."]);
  });

  it("never splits a paragraph across chunks unless it alone exceeds the limit", () => {
    const paragraph = "Sentence.".repeat(200); // well under the limit
    const paragraphs = Array.from({ length: 5 }, (_, i) => `${paragraph} #${i}`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text);
    for (const p of paragraphs) {
      const containingChunks = chunks.filter((c) => c.includes(p));
      expect(containingChunks).toHaveLength(1);
    }
  });

  it("flushes into a new chunk once the running total would exceed the limit", () => {
    const paragraph = "x".repeat(7000);
    const text = [paragraph, paragraph, paragraph].join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("splits a single oversized paragraph on sentence boundaries", () => {
    const sentence = "This is a reasonably long sentence for testing purposes.";
    const paragraph = Array.from({ length: 400 }, () => sentence).join(" "); // > 12,000 chars
    expect(paragraph.length).toBeGreaterThan(MAX_CHUNK_CHARS);

    const chunks = chunkText(paragraph);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    // No sentence content is dropped.
    expect(chunks.join(" ")).toContain(sentence);
  });

  it("drops blank paragraphs between real ones", () => {
    const text = "\n\nFirst.\n\n\n\nSecond.\n\n";
    expect(chunkText(text)).toEqual(["First.\n\nSecond."]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});
