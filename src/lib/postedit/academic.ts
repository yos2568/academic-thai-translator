import "server-only";
import { generate } from "@/lib/engines";
import type { ProviderConfig } from "@/lib/providers";

const SYSTEM = `You are a meticulous Thai academic-language editor. Rewrite a draft translation into formal academic Thai while preserving its meaning exactly. Preserve every number, date, currency, unit, URL, citation, equation, code fragment, proper noun, and parenthesized English technical term verbatim. Preserve paragraph boundaries. Do not add facts or commentary. Output only the revised Thai text.`;

export function postEdit(source: string, draft: string, glossary: string, config: ProviderConfig) {
  return generate(config, {
    system: SYSTEM,
    prompt: [`English source (for verification):\n${source}`, glossary ? `Terminology glossary:\n${glossary}` : "", `Thai draft to revise:\n${draft}`].filter(Boolean).join("\n\n---\n\n"),
  });
}
