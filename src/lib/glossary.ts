/** Seed terms for music-tech / AI handbooks (overridable by pinned or extracted terms). */
export const DOMAIN_SEED_GLOSSARY: ReadonlyArray<[string, string]> = [
  ["artificial intelligence", "ปัญญาประดิษฐ์"],
  ["ai", "ปัญญาประดิษฐ์"],
  ["generative ai", "ปัญญาประดิษฐ์เชิงสร้างสรรค์"],
  ["large language model", "แบบจำลองภาษาขนาดใหญ่"],
  ["large language models", "แบบจำลองภาษาขนาดใหญ่"],
  ["llm", "แบบจำลองภาษาขนาดใหญ่"],
  ["machine learning", "การเรียนรู้ของเครื่อง"],
  ["deep learning", "การเรียนรู้เชิงลึก"],
  ["neural network", "โครงข่ายประสาทเทียม"],
  ["prompt", "ข้อความสั่งงาน"],
  ["prompt engineering", "วิศวกรรมข้อความสั่งงาน"],
  ["training data", "ข้อมูลฝึกฝน"],
  ["dataset", "ชุดข้อมูล"],
];

export function seedDomainGlossary(existing: Map<string, string>): void {
  for (const [en, th] of DOMAIN_SEED_GLOSSARY) {
    if (!existing.has(en)) existing.set(en, th);
  }
}

export function extractGlossaryTerms(thaiText: string, existing: Map<string, string>): void {
  const pattern = /([\u0E00-\u0E7F][\u0E00-\u0E7F\s]{1,60}?)\s*\(([A-Za-z][A-Za-z0-9 &/-]{1,60})\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(thaiText)) !== null && existing.size < 100) {
    const english = match[2].trim().toLowerCase();
    if (!existing.has(english)) existing.set(english, match[1].trim());
  }
}

export function formatGlossary(glossary: Map<string, string>): string {
  return [...glossary].map(([en, th]) => `${en} → ${th}`).join("\n");
}
