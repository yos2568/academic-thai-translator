import "server-only";
import type { ProviderConfig } from "@/lib/providers";
import { assertPublicHost } from "@/lib/net-guard";
import type { GenerateOptions, TranslationEngine } from "./types";
import { redactUrls } from "./types";

export type OpenAiCompatibleConfig = Extract<ProviderConfig, { provider: "openai-compatible" }>;

export async function generateOpenAiCompatible(
  config: { baseUrl: string; apiKey?: string; model: string },
  options: GenerateOptions
): Promise<string> {
  await assertPublicHost(config.baseUrl);
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    // Do not follow a public upstream redirect to an unchecked private host.
    redirect: "error",
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: 0.1,
      messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Provider returned an invalid response.");
  options.onDelta?.(text);
  return text;
}

async function generate(config: OpenAiCompatibleConfig, options: GenerateOptions): Promise<string> {
  return generateOpenAiCompatible(config, options);
}

async function test(config: OpenAiCompatibleConfig) {
  try {
    await generate(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

export const openAiCompatibleEngine: TranslationEngine<OpenAiCompatibleConfig> = {
  id: "openai-compatible",
  generate,
  test,
};
