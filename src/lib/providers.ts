import "server-only";

export type ProviderConfig =
  | { provider: "anthropic"; apiKey: string; model?: string }
  | { provider: "openai-compatible"; baseUrl: string; apiKey?: string; model: string }
  | { provider: "ollama"; baseUrl: string; model: string }
  | {
      provider: "oauth-openai-compatible";
      baseUrl: string;
      model: string;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
    };

export interface PipelineConfig {
  draft: ProviderConfig;
  postedit?: ProviderConfig | null;
}

const MAX_HEADER_LENGTH = 16_384;

function cleanUrl(value: unknown, fallback?: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!raw) throw new Error("A provider URL is required.");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Provider URL must use HTTP or HTTPS.");
  return url.toString().replace(/\/$/, "");
}

export function validateProvider(value: unknown): ProviderConfig {
  if (!value || typeof value !== "object") throw new Error("Invalid provider configuration.");
  const item = value as Record<string, unknown>;
  if (item.provider === "anthropic") {
    const apiKey = typeof item.apiKey === "string" ? item.apiKey.trim() : "";
    if (!apiKey) throw new Error("An Anthropic API key is required.");
    return { provider: "anthropic", apiKey, model: typeof item.model === "string" ? item.model.trim() : undefined };
  }
  if (item.provider === "openai-compatible") {
    const model = typeof item.model === "string" ? item.model.trim() : "";
    if (!model) throw new Error("A model name is required.");
    return { provider: item.provider, baseUrl: cleanUrl(item.baseUrl), apiKey: typeof item.apiKey === "string" ? item.apiKey.trim() : "", model };
  }
  if (item.provider === "ollama") {
    const model = typeof item.model === "string" ? item.model.trim() : "";
    if (!model) throw new Error("An Ollama model name is required.");
    return { provider: item.provider, baseUrl: cleanUrl(item.baseUrl, "http://localhost:11434"), model };
  }
  if (item.provider === "oauth-openai-compatible") {
    const model = typeof item.model === "string" ? item.model.trim() : "";
    if (!model) throw new Error("A model name is required.");
    const clientId = typeof item.clientId === "string" ? item.clientId.trim() : "";
    if (!clientId) throw new Error("An OAuth client ID is required.");
    const clientSecret = typeof item.clientSecret === "string" ? item.clientSecret.trim() : "";
    if (!clientSecret) throw new Error("An OAuth client secret is required.");
    const scope = typeof item.scope === "string" && item.scope.trim() ? item.scope.trim() : undefined;
    return {
      provider: "oauth-openai-compatible",
      baseUrl: cleanUrl(item.baseUrl),
      tokenUrl: cleanUrl(item.tokenUrl),
      model,
      clientId,
      clientSecret,
      scope,
    };
  }
  throw new Error("Unsupported provider.");
}

export function parseProviderHeader(request: Request): PipelineConfig | null {
  const header = request.headers.get("x-provider-config");
  if (!header) return null;
  if (header.length > MAX_HEADER_LENGTH) throw new Error("Provider configuration is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new Error("Invalid provider configuration header.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid provider configuration.");
  const item = parsed as Record<string, unknown>;
  return {
    draft: validateProvider(item.draft),
    postedit: item.postedit ? validateProvider(item.postedit) : null,
  };
}

export function envPipelineConfig(): PipelineConfig | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      draft: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL },
      postedit: null,
    };
  }
  if (process.env.LOCAL_OPENAI_BASE_URL && process.env.LOCAL_OPENAI_MODEL) {
    return {
      draft: {
        provider: "openai-compatible",
        baseUrl: process.env.LOCAL_OPENAI_BASE_URL.replace(/\/$/, ""),
        apiKey: process.env.LOCAL_OPENAI_API_KEY ?? "",
        model: process.env.LOCAL_OPENAI_MODEL,
      },
      postedit: null,
    };
  }
  return null;
}

export function getPipelineConfig(request: Request): PipelineConfig {
  const config = parseProviderHeader(request) ?? envPipelineConfig();
  if (!config) throw new Error("No translation provider is configured. Open Settings and add your provider.");
  return config;
}

export function publicProvider(config: ProviderConfig) {
  return { provider: config.provider, baseUrl: "baseUrl" in config ? config.baseUrl : undefined, model: config.model };
}
