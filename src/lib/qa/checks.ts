export type QaKind = "numbers" | "citations" | "urls";
export interface QaCheck { kind: QaKind; label: string; status: "pass" | "warn"; missing: string[]; expected: number; found: number }
export interface QaReport { chunk: number; checks: QaCheck[]; passed: boolean }

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])];
}

/** Thai-numeral digits (๐-๙) rendered by a post-editor read as their Arabic equivalent. */
function normalizeDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

/** Comparison form: Thai digits converted to Arabic, thousands separators stripped. */
function normalizeForComparison(value: string): string {
  return normalizeDigits(value).replace(/,/g, "");
}

export function checkTranslation(source: string, target: string, chunk: number): QaReport {
  const definitions: Array<[QaKind, string, RegExp]> = [
    ["numbers", "Numbers and dates", /(?<![\p{L}])\d[\d,.]*(?:%|\s?(?:kg|km|cm|mm|USD|THB))?/gu],
    ["citations", "Citations", /\([A-Z][^()]{0,60},\s*\d{4}[a-z]?\)|\[\d+(?:[-,]\s*\d+)*\]/g],
    ["urls", "URLs", /https?:\/\/[^\s)\]]+/g],
  ];
  const normalizedTarget = normalizeForComparison(target);
  const checks = definitions.map(([kind, label, pattern]) => {
    const values = uniqueMatches(source, pattern);
    const missing = values.filter((value) => {
      if (target.includes(value)) return false;
      // A post-editor may render digits as Thai numerals (๒๐๒๔) or drop
      // thousands separators; check the normalized form before flagging.
      return !normalizedTarget.includes(normalizeForComparison(value));
    });
    return {
      kind,
      label,
      missing,
      expected: values.length,
      found: values.length - missing.length,
      status: missing.length ? "warn" as const : "pass" as const,
    };
  });
  return { chunk, checks, passed: checks.every((check) => check.status === "pass") };
}
