import "server-only";
import type { ProviderConfig } from "@/lib/providers";
import type { GenerateOptions, TestResult, TranslationEngine } from "./types";
import { anthropicEngine } from "./anthropic";
import { openAiCompatibleEngine } from "./openai-compatible";
import { ollamaEngine } from "./ollama";
import { oauthOpenAiCompatibleEngine } from "./oauth-openai-compatible";

type EngineMap = { [K in ProviderConfig["provider"]]: TranslationEngine<Extract<ProviderConfig, { provider: K }>> };

const engines: EngineMap = {
  anthropic: anthropicEngine,
  "openai-compatible": openAiCompatibleEngine,
  ollama: ollamaEngine,
  "oauth-openai-compatible": oauthOpenAiCompatibleEngine,
};

export function engineFor<C extends ProviderConfig>(config: C): TranslationEngine<C> {
  return engines[config.provider] as unknown as TranslationEngine<C>;
}

export function generate(config: ProviderConfig, options: GenerateOptions): Promise<string> {
  return engineFor(config).generate(config, options);
}

export function testProvider(config: ProviderConfig): Promise<TestResult> {
  return engineFor(config).test(config);
}
