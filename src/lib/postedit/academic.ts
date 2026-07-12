import "server-only";
import { generate } from "@/lib/engines";
import type { ProviderConfig } from "@/lib/providers";

const SYSTEM = `You are a Thai academic handbook editor (บรรณาธิการตำรา/คู่มือวิชาชีพ).

Polish a draft English→Thai translation into publication-ready formal academic Thai.

Rules:
- Keep meaning exact — no new facts, no omissions.
- Prefer natural textbook register over word-for-word calque.
- Keep numbers, URLs, citations, English product/brand names, and [[IMG:…]] markers exactly.
- Keep parenthesized English technical terms on first mention.
- Fix awkward phrasing, wrong register, and OCR-induced nonsense.
- Output only the revised Thai text.`;

export function postEdit(source: string, draft: string, glossary: string, config: ProviderConfig) {
  return generate(config, {
    system: SYSTEM,
    prompt: [
      `English source (verification only):\n${source}`,
      glossary ? `Terminology glossary:\n${glossary}` : "",
      `Thai draft to polish:\n${draft}`,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),
  });
}
