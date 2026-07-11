import "server-only";
import type { ProviderConfig } from "@/lib/providers";
import { assertPublicHost } from "@/lib/net-guard";
import { generateOpenAiCompatible } from "./openai-compatible";
import type { GenerateOptions, TranslationEngine } from "./types";
import { redactUrls } from "./types";

export type OAuthOpenAiCompatibleConfig = Extract<ProviderConfig, { provider: "oauth-openai-compatible" }>;

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Module-level cache: safe because config (including the client secret) is
// per-request and never persisted, but a token acquired for one request can
// be reused by a later request that presents the same client credentials
// within its lifetime, avoiding a token-endpoint round trip on every call.
const tokenCache = new Map<string, CachedToken>();
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const DEFAULT_TOKEN_TTL_SECONDS = 300;

function cacheKey(config: OAuthOpenAiCompatibleConfig): string {
  return `${config.tokenUrl}::${config.clientId}`;
}

async function fetchAccessToken(config: OAuthOpenAiCompatibleConfig): Promise<string> {
  const key = cacheKey(config);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) {
    return cached.token;
  }

  await assertPublicHost(config.tokenUrl);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // Do not follow a public upstream redirect to an unchecked private host.
    redirect: "error",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...(config.scope ? { scope: config.scope } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status}).`);
  const data = await response.json();
  const token = data?.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Token endpoint returned an invalid response.");
  }
  const expiresInSeconds = typeof data?.expires_in === "number" && data.expires_in > 0 ? data.expires_in : DEFAULT_TOKEN_TTL_SECONDS;
  tokenCache.set(key, { token, expiresAt: now + expiresInSeconds * 1000 });
  return token;
}

async function generate(config: OAuthOpenAiCompatibleConfig, options: GenerateOptions): Promise<string> {
  const token = await fetchAccessToken(config);
  return generateOpenAiCompatible({ baseUrl: config.baseUrl, apiKey: token, model: config.model }, options);
}

async function test(config: OAuthOpenAiCompatibleConfig) {
  try {
    await generate(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    // Errors originate from our own thrown messages or the fetch layer,
    // neither of which ever interpolates the client secret or the
    // resolved access token; redact URLs defensively like every other
    // provider's test() path.
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

export const oauthOpenAiCompatibleEngine: TranslationEngine<OAuthOpenAiCompatibleConfig> = {
  id: "oauth-openai-compatible",
  generate,
  test,
};

export function clearOAuthTokenCacheForTests(): void {
  tokenCache.clear();
}
