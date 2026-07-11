import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "@/lib/providers";
import { assertPublicHost } from "@/lib/net-guard";

function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "[redacted upstream]");
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  onDelta?: (text: string) => void;
}

export async function generate(config: ProviderConfig, options: GenerateOptions): Promise<string> {
  if (config.provider === "anthropic") {
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

  const isOllama = config.provider === "ollama";
  await assertPublicHost(config.baseUrl);
  const endpoint = isOllama ? `${config.baseUrl}/api/chat` : `${config.baseUrl}/chat/completions`;
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (!isOllama && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    // Do not follow a public upstream redirect to an unchecked private host.
    redirect: "error",
    body: JSON.stringify(isOllama
      ? { model: config.model, stream: false, messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }] }
      : { model: config.model, stream: false, temperature: 0.1, messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }] }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  const data = await response.json();
  const text = isOllama ? data?.message?.content : data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Provider returned an invalid response.");
  options.onDelta?.(text);
  return text;
}

export async function testProvider(config: ProviderConfig): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    if (config.provider === "ollama") {
      await assertPublicHost(config.baseUrl);
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Connection failed (${response.status}).`);
      const data = await response.json();
      return { ok: true, models: Array.isArray(data.models) ? data.models.map((m: { name?: string }) => m.name).filter(Boolean) : [] };
    }
    await generate(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}
