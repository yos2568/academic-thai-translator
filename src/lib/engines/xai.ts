import "server-only";
import type { ProviderConfig } from "@/lib/providers";
import { XAI_DEFAULT_MODEL } from "@/lib/xai/constants";
import {
  accessTokenNeedsRefresh,
  refreshAccessToken,
  resolveXaiBaseUrl,
  type XaiTokenSet,
} from "@/lib/xai/oauth";
import { generateOpenAiCompatible } from "./openai-compatible";
import type { GenerateOptions, TranslationEngine } from "./types";
import { redactUrls } from "./types";

export type XaiApiConfig = Extract<ProviderConfig, { provider: "xai" }>;
export type XaiOauthConfig = Extract<ProviderConfig, { provider: "xai-oauth" }>;

const oauthTokenCache = new Map<string, XaiTokenSet>();

function cacheKey(refreshToken: string) {
  return refreshToken.slice(0, 24);
}

async function resolveOauthBearer(config: XaiOauthConfig): Promise<string> {
  const key = cacheKey(config.refreshToken);
  const cached = oauthTokenCache.get(key);
  const accessToken = cached?.accessToken || config.accessToken;
  const refreshToken = cached?.refreshToken || config.refreshToken;
  const expiresAt = cached?.expiresAt ?? config.expiresAt;

  if (accessToken && !accessTokenNeedsRefresh(expiresAt)) {
    return accessToken;
  }

  const refreshed = await refreshAccessToken(refreshToken);
  oauthTokenCache.set(key, refreshed);
  return refreshed.accessToken;
}

async function resolveApiBearer(config: XaiApiConfig): Promise<string> {
  const key = config.apiKey?.trim();
  if (!key) throw new Error("An xAI API key is required.");
  return key;
}

async function generateWithBearer(
  baseUrl: string,
  model: string,
  bearer: string,
  options: GenerateOptions
): Promise<string> {
  return generateOpenAiCompatible(
    { baseUrl: resolveXaiBaseUrl(baseUrl), apiKey: bearer, model: model || XAI_DEFAULT_MODEL },
    options
  );
}

async function generateXai(config: XaiApiConfig, options: GenerateOptions): Promise<string> {
  const bearer = await resolveApiBearer(config);
  return generateWithBearer(config.baseUrl ?? "", config.model ?? XAI_DEFAULT_MODEL, bearer, options);
}

async function generateXaiOauth(config: XaiOauthConfig, options: GenerateOptions): Promise<string> {
  const bearer = await resolveOauthBearer(config);
  return generateWithBearer(config.baseUrl ?? "", config.model ?? XAI_DEFAULT_MODEL, bearer, options);
}

async function testXai(config: XaiApiConfig) {
  try {
    await generateXai(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

async function testXaiOauth(config: XaiOauthConfig) {
  try {
    await generateXaiOauth(config, { system: "Reply with OK only.", prompt: "OK" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? redactUrls(error.message) : "Connection failed." };
  }
}

export const xaiEngine: TranslationEngine<XaiApiConfig> = {
  id: "xai",
  generate: generateXai,
  test: testXai,
};

export const xaiOauthEngine: TranslationEngine<XaiOauthConfig> = {
  id: "xai-oauth",
  generate: generateXaiOauth,
  test: testXaiOauth,
};

export function clearXaiOauthTokenCacheForTests() {
  oauthTokenCache.clear();
}
