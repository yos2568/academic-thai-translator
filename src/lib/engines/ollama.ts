import "server-only";
import type { ProviderConfig } from "@/lib/providers";
import { assertPublicHost } from "@/lib/net-guard";
import type { GenerateOptions, TranslationEngine } from "./types";
import { redactUrls } from "./types";

type OllamaConfig = Extract<ProviderConfig, { provider: "ollama" }>;

async function generate(config: OllamaConfig, options: GenerateOptions): Promise<string> {
  await assertPublicHost(config.baseUrl);
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Do not follow a public upstream redirect to an unchecked private host.
    redirect: "error",
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  const data = await response.json();
  const text = data?.message?.content;
  if (typeof text !== "string") throw new Error("Provider returned an invalid response.");
  options.onDelta?.(text);
  return text;
}

async function test(config: OllamaConfig) {
  try {
    await assertPublicHost(config.baseUrl);
    const response = await fetch(`${config.baseUrl}/api/tags`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Connection failed (${response.status}).`);
    const data = await response.json();
    return {
      ok: true,
      models: Array.isArray(data.models) ? data.models.map((m: { name?: string }) => m.name).filter(Boolean) : [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

export const ollamaEngine: TranslationEngine<OllamaConfig> = { id: "ollama", generate, test };
