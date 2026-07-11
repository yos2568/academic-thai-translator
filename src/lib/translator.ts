import "server-only";
import { generate } from "@/lib/engines";
import type { ProviderConfig } from "@/lib/providers";

const SYSTEM_PROMPT = `You are an expert academic translator specializing in English-to-Thai translation. Use formal academic Thai. Translate faithfully without summarizing or adding content. Use established Royal Society terminology. On first occurrence, retain the English technical term in parentheses. Preserve citations, numbers, units, equations, formulas, URLs, proper nouns, and paragraph boundaries verbatim. Output only Thai translation.`;

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
      totalChunks > 1 ? `This is part ${chunkIndex + 1} of ${totalChunks}. Translate only this part.` : "",
      glossary ? `Keep these established translations consistent:\n${glossary}` : "",
      `Translate into formal academic Thai:\n\n${chunk}`,
    ].filter(Boolean).join("\n\n"),
    onDelta,
  });
}
