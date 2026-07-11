import "server-only";
import type { ProviderConfig } from "@/lib/providers";

export interface GenerateOptions {
  system: string;
  prompt: string;
  onDelta?: (text: string) => void;
}

export interface TestResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface TranslationEngine<C extends ProviderConfig = ProviderConfig> {
  readonly id: C["provider"];
  generate(config: C, options: GenerateOptions): Promise<string>;
  test(config: C): Promise<TestResult>;
}

export function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "[redacted upstream]");
}
