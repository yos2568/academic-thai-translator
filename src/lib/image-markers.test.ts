import { describe, expect, it } from "vitest";
import { injectImageMarkers, splitByImageMarkers, stripImageMarkers } from "./image-markers";

describe("image markers", () => {
  it("injects markers after anchored paragraphs", () => {
    const text = "Para A\n\nPara B\n\nPara C";
    const out = injectImageMarkers(text, [
      { id: "pdf-1", anchorParagraphIndex: 1 },
      { id: "pdf-2", page: 1 },
    ], [2, 1]);
    expect(out).toContain("[[IMG:pdf-1]]");
    expect(out).toContain("[[IMG:pdf-2]]");
    expect(out.indexOf("Para B")).toBeLessThan(out.indexOf("[[IMG:pdf-1]]"));
  });

  it("splits and strips markers", () => {
    const text = "Hello\n\n[[IMG:a-1]]\n\nWorld";
    const parts = splitByImageMarkers(text);
    expect(parts).toEqual([
      { type: "text", value: "Hello\n\n" },
      { type: "image", id: "a-1" },
      { type: "text", value: "\n\nWorld" },
    ]);
    expect(stripImageMarkers(text)).toBe("Hello\n\nWorld");
  });
});
