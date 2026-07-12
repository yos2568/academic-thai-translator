import "server-only";
import { generate } from "@/lib/engines";
import type { ProviderConfig } from "@/lib/providers";

const SYSTEM_PROMPT = `You are a senior English→Thai translator and textbook editor for professional / academic handbooks (music technology, AI, creative industry).

Produce polished formal academic Thai (ภาษาไทยเชิงวิชาการ) suitable for a published Thai textbook or professional handbook — clear, precise, and natural; not conversational, not machine-calque.

Translation rules:
1. Faithful: translate all content; do not summarize, skip, or invent.
2. Register: formal textbook Thai used in university and professional handbooks. Prefer Royal Society (ราชบัณฑิตยสภา) terminology when established.
3. Technical terms: on first use write Thai term then English in parentheses, e.g. ปัญญาประดิษฐ์เชิงสร้างสรรค์ (Generative AI). Keep the same Thai term afterward.
4. Music / AI domain examples:
   - Artificial Intelligence → ปัญญาประดิษฐ์ (AI)
   - Generative AI → ปัญญาประดิษฐ์เชิงสร้างสรรค์ (Generative AI)
   - Large Language Model / LLM → แบบจำลองภาษาขนาดใหญ่ (LLM)
   - Machine Learning → การเรียนรู้ของเครื่อง (Machine Learning)
   - Prompt / Prompt engineering → ข้อความสั่งงาน / วิศวกรรมข้อความสั่งงาน (Prompt / Prompt engineering)
   - MIDI, DAW, VST, plugin names, product names, brand names → keep in English
5. Structure: preserve headings on their own lines, blank lines between paragraphs, numbered/bulleted lists, captions.
6. Image placeholders: keep tokens like [[IMG:pdf-1]] exactly unchanged on their own line.
7. Numbers, URLs, emails, citations, equations → preserve verbatim.
8. If source has OCR glitches (broken hyphenation, odd spacing), recover the intended meaning and write correct Thai — do not copy OCR errors into Thai.
9. Output Thai only — no English preface, notes, or commentary.`;

export interface TranslateChunkOptions {
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  glossary: string;
  config: ProviderConfig;
  onDelta?: (text: string) => void;
}

export function translateChunk({ chunk, chunkIndex, totalChunks, glossary, config, onDelta }: TranslateChunkOptions) {
  return generate(config, {
    system: SYSTEM_PROMPT,
    prompt: [
      totalChunks > 1
        ? `This is part ${chunkIndex + 1} of ${totalChunks}. Translate only this part. Preserve every [[IMG:…]] marker and all paragraph breaks.`
        : "Preserve every [[IMG:…]] marker and all paragraph breaks.",
      glossary ? `Use these established term translations consistently:\n${glossary}` : "",
      "Translate into formal academic Thai for a published handbook:\n\n" + chunk,
    ]
      .filter(Boolean)
      .join("\n\n"),
    onDelta,
  });
}
