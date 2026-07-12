import { describe, expect, it } from "vitest";
import { extractGlossaryTerms, formatGlossary } from "./glossary";

describe("extractGlossaryTerms", () => {
  it("captures a Thai term followed by its parenthesized English source", () => {
    const glossary = new Map<string, string>();
    extractGlossaryTerms("งานวิจัยเชิงคุณภาพ (qualitative research) เป็นวิธีการศึกษา", glossary);
    expect(glossary.get("qualitative research")).toBe("งานวิจัยเชิงคุณภาพ");
  });

  it("dedupes by lowercased English key and keeps the first Thai translation seen", () => {
    const glossary = new Map<string, string>();
    extractGlossaryTerms("อภิปัญญา (Metacognition) ...ภายหลัง อีกคำ (METACOGNITION)", glossary);
    expect(glossary.size).toBe(1);
    expect(glossary.get("metacognition")).toBe("อภิปัญญา");
  });

  it("stops adding new terms once the map reaches 100 entries", () => {
    const glossary = new Map<string, string>();
    for (let i = 0; i < 100; i++) glossary.set(`term${i}`, `ไทย${i}`);
    extractGlossaryTerms("คำใหม่ (brand new term)", glossary);
    expect(glossary.size).toBe(100);
    expect(glossary.has("brand new term")).toBe(false);
  });

  it("ignores text with no parenthesized English term", () => {
    const glossary = new Map<string, string>();
    extractGlossaryTerms("ข้อความภาษาไทยธรรมดาไม่มีวงเล็บ", glossary);
    expect(glossary.size).toBe(0);
  });
});

describe("formatGlossary", () => {
  it("renders each entry as 'english → thai' on its own line", () => {
    const glossary = new Map([
      ["qualitative research", "งานวิจัยเชิงคุณภาพ"],
      ["metacognition", "อภิปัญญา"],
    ]);
    expect(formatGlossary(glossary)).toBe(
      "qualitative research → งานวิจัยเชิงคุณภาพ\nmetacognition → อภิปัญญา"
    );
  });

  it("returns an empty string for an empty glossary", () => {
    expect(formatGlossary(new Map())).toBe("");
  });
});
