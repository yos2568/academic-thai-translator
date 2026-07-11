export function extractGlossaryTerms(thaiText: string, existing: Map<string, string>): void {
  const pattern = /([฀-๿][฀-๿\s]{1,60}?)\s*\(([A-Za-z][A-Za-z0-9 &/-]{1,60})\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(thaiText)) !== null && existing.size < 100) {
    const english = match[2].trim().toLowerCase();
    if (!existing.has(english)) existing.set(english, match[1].trim());
  }
}

export function formatGlossary(glossary: Map<string, string>): string {
  return [...glossary].map(([en, th]) => `${en} → ${th}`).join("\n");
}
