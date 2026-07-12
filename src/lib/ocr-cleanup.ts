/**
 * Normalize OCR / extraction artifacts before translation.
 * Keeps content; only fixes spacing and common scan glitches.
 */

export function cleanupExtractedText(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Collapse hyphenated line breaks: "exam-\nple" → "example"
  text = text.replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2");

  // Join single newlines inside paragraphs (OCR often breaks mid-sentence)
  // but keep blank lines as paragraph boundaries.
  text = text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
    )
    .filter(Boolean)
    .join("\n\n");

  // Fix space before punctuation
  text = text.replace(/\s+([,.;:!?])/g, "$1");

  // Fix broken spaces inside Thai runs introduced by mixed OCR: "การ ตอบสนอง" is OK for words
  // but "ที ่" style tone-mark splits:
  text = text.replace(/([ก-ฮ])\s+([่้๊๋์ํ็])/g, "$1$2");
  text = text.replace(/([ัิีึืุูเแโใไ])\s+/g, "$1");

  // Normalize fancy quotes/dashes
  text = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-");

  // Common title casing noise
  text = text.replace(/\bAi\b/g, "AI");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
