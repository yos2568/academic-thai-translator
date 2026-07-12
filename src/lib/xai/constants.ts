/** Public Grok CLI OAuth client (same client used by Grok CLI / Hermes xai-oauth). */
export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE =
  "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
export const XAI_API_BASE_URL = "https://api.x.ai/v1";
export const XAI_DEFAULT_MODEL = "grok-4.5";
export const XAI_ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
export const XAI_DEFAULT_TOKEN_TTL_SECONDS = 21_600; // 6h fallback when expires_in missing
