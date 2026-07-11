export type QaKind = "numbers" | "citations" | "urls";
export interface QaCheck { kind: QaKind; label: string; status: "pass" | "warn"; missing: string[] }
export interface QaReport { chunk: number; checks: QaCheck[]; passed: boolean }

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])];
}

export function checkTranslation(source: string, target: string, chunk: number): QaReport {
  const definitions: Array<[QaKind, string, RegExp]> = [
    ["numbers", "Numbers and dates", /(?<![\p{L}])\d[\d,.]*(?:%|\s?(?:kg|km|cm|mm|USD|THB))?/gu],
    ["citations", "Citations", /\([A-Z][^()]{0,60},\s*\d{4}[a-z]?\)|\[\d+(?:[-,]\s*\d+)*\]/g],
    ["urls", "URLs", /https?:\/\/[^\s)\]]+/g],
  ];
  const checks = definitions.map(([kind, label, pattern]) => {
    const missing = uniqueMatches(source, pattern).filter((value) => !target.includes(value));
    return { kind, label, missing, status: missing.length ? "warn" as const : "pass" as const };
  });
  return { chunk, checks, passed: checks.every((check) => check.status === "pass") };
}
