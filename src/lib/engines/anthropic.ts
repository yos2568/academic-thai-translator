import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "@/lib/providers";
import type { GenerateOptions, TranslationEngine } from "./types";
import { redactUrls } from "./types";

type AnthropicConfig = Extract<ProviderConfig, { provider: "anthropic" }>;

async function generate(config: AnthropicConfig, options: GenerateOptions): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const stream = client.messages.stream({
    model: config.model || "claude-sonnet-4-5",
    max_tokens: 16000,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
  });
  stream.on("text", (text) => options.onDelta?.(text));
  const message = await stream.finalMessage();
  return message.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("");
}

async function test(config: AnthropicConfig) {
  try {
    await generate(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

export const anthropicEngine: TranslationEngine<AnthropicConfig> = { id: "anthropic", generate, test };
