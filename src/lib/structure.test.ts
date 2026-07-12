import { describe, expect, it } from "vitest";
import { parseDocumentBlocks } from "./structure";

describe("parseDocumentBlocks", () => {
  it("detects title, headings, body, list, and figure caption", () => {
    const text = [
      "Introduction to Biology",
      "",
      "Chapter 1 Photosynthesis",
      "",
      "Plants convert light energy into chemical energy.",
      "",
      "- Chlorophyll absorbs light",
      "- Water is split",
      "",
      "Figure 1 Cross-section of a leaf",
    ].join("\n");

    const blocks = parseDocumentBlocks(text);
    expect(blocks[0]).toMatchObject({ kind: "title", text: "Introduction to Biology" });
    expect(blocks.some((b) => b.kind === "h1" && /Photosynthesis/i.test(b.text))).toBe(true);
    expect(blocks.some((b) => b.kind === "paragraph")).toBe(true);
    expect(blocks.filter((b) => b.kind === "list").length).toBeGreaterThanOrEqual(2);
    expect(blocks.some((b) => b.kind === "caption" && /Figure 1/i.test(b.text))).toBe(true);
  });

  it("handles Thai figure captions", () => {
    const blocks = parseDocumentBlocks("ภาพที่ 3 โครงสร้างของเซลล์\n\nเนื้อหาต่อไปนี้เป็นการอธิบายเพิ่มเติม");
    expect(blocks[0].kind).toBe("caption");
    expect(blocks[1].kind).toBe("paragraph");
  });
});
