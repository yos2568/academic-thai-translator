import { describe, expect, it } from "vitest";
import { cleanupExtractedText } from "./ocr-cleanup";

describe("cleanupExtractedText", () => {
  it("joins hyphenated line breaks and paragraph newlines", () => {
    const raw = "This is an exam-\nple of OCR.\n\nNext paragraph.";
    expect(cleanupExtractedText(raw)).toBe("This is an example of OCR.\n\nNext paragraph.");
  });

  it("normalizes Ai to AI", () => {
    expect(cleanupExtractedText("The Musician's Ai Handbook")).toContain("AI");
  });
});
