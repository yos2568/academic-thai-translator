import "server-only";
import {
  XAI_ACCESS_TOKEN_REFRESH_SKEW_MS,
  XAI_API_BASE_URL,
  XAI_DEFAULT_TOKEN_TTL_SECONDS,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_SCOPE,
} from "./constants";

export interface XaiOidcDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint: string;
}

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface XaiTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

export class XaiAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "XaiAuthError";
  }
}

let discoveryCache: { value: XaiOidcDiscovery; expiresAt: number } | null = null;

function assertXaiUrl(url: string, field: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new XaiAuthError(`Invalid ${field}.`, "xai_invalid_endpoint");
  }
  if (parsed.protocol !== "https:") {
    throw new XaiAuthError(`${field} must use HTTPS.`, "xai_invalid_endpoint");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "auth.x.ai" && host !== "x.ai" && !host.endsWith(".x.ai")) {
    throw new XaiAuthError(`${field} must point at an xAI host.`, "xai_invalid_endpoint");
  }
}

export async function discoverXaiOidc(timeoutMs = 15_000): Promise<XaiOidcDiscovery> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expiresAt > now) return discoveryCache.value;

  const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    throw new XaiAuthError(`OIDC discovery failed (${response.status}).`, "xai_discovery_failed", response.status);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const authorizationEndpoint = String(payload.authorization_endpoint ?? "").trim();
  const tokenEndpoint = String(payload.token_endpoint ?? "").trim();
  const deviceAuthorizationEndpoint = String(payload.device_authorization_endpoint ?? "").trim();
  if (!authorizationEndpoint || !tokenEndpoint || !deviceAuthorizationEndpoint) {
    throw new XaiAuthError("OIDC discovery response incomplete.", "xai_discovery_incomplete");
  }
  assertXaiUrl(authorizationEndpoint, "authorization_endpoint");
  assertXaiUrl(tokenEndpoint, "token_endpoint");
  assertXaiUrl(deviceAuthorizationEndpoint, "device_authorization_endpoint");

  const value: XaiOidcDiscovery = {
    authorizationEndpoint,
    tokenEndpoint,
    deviceAuthorizationEndpoint,
  };
  discoveryCache = { value, expiresAt: now + 3_600_000 };
  return value;
}

export async function startDeviceCodeFlow(timeoutMs = 20_000): Promise<DeviceCodeStart> {
  const discovery = await discoverXaiOidc(timeoutMs);
  const response = await fetch(discovery.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPE,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new XaiAuthError(
      `Device authorization failed (${response.status}).${detail ? ` ${detail}` : ""}`,
      "xai_device_code_failed",
      response.status
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const deviceCode = String(payload.device_code ?? "").trim();
  const userCode = String(payload.user_code ?? "").trim();
  const verificationUri = String(payload.verification_uri ?? payload.verification_url ?? "").trim();
  const verificationUriComplete = String(payload.verification_uri_complete ?? "").trim() || undefined;
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 900;
  const interval = typeof payload.interval === "number" && payload.interval > 0 ? payload.interval : 5;
  if (!deviceCode || !userCode || !verificationUri) {
    throw new XaiAuthError("Device authorization response incomplete.", "xai_device_code_incomplete");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval,
  };
}

function parseTokenResponse(payload: Record<string, unknown>): XaiTokenSet {
  const accessToken = String(payload.access_token ?? "").trim();
  const refreshToken = String(payload.refresh_token ?? "").trim();
  if (!accessToken) {
    throw new XaiAuthError("Token response missing access_token.", "xai_token_missing_access");
  }
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : XAI_DEFAULT_TOKEN_TTL_SECONDS;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: String(payload.token_type ?? "Bearer").trim() || "Bearer",
  };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "denied"; error: string }
  | { status: "expired"; error: string }
  | { status: "ready"; tokens: XaiTokenSet };

export async function pollDeviceCode(
  deviceCode: string,
  timeoutMs = 20_000
): Promise<DevicePollResult> {
  const discovery = await discoverXaiOidc(timeoutMs);
  const response = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: XAI_OAUTH_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) {
    const tokens = parseTokenResponse(payload);
    if (!tokens.refreshToken) {
      throw new XaiAuthError(
        "Token response missing refresh_token. Approve offline access and try again.",
        "xai_token_missing_refresh"
      );
    }
    return { status: "ready", tokens };
  }

  const error = String(payload.error ?? "").trim();
  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") {
    const interval = typeof payload.interval === "number" && payload.interval > 0 ? payload.interval : 10;
    return { status: "slow_down", interval };
  }
  if (error === "access_denied") {
    return { status: "denied", error: "Authorization was denied in the browser." };
  }
  if (error === "expired_token") {
    return { status: "expired", error: "The sign-in code expired. Start again." };
  }
  if (response.status === 403) {
    throw new XaiAuthError(
      "This Grok account is not authorized for API/OAuth access. Use an XAI_API_KEY from console.x.ai or upgrade SuperGrok access.",
      "xai_oauth_tier_denied",
      403
    );
  }
  const detail = String(payload.error_description ?? payload.error ?? response.status).slice(0, 240);
  throw new XaiAuthError(`Device token poll failed: ${detail}`, "xai_device_poll_failed", response.status);
}

export async function refreshAccessToken(
  refreshToken: string,
  timeoutMs = 20_000
): Promise<XaiTokenSet> {
  if (!refreshToken.trim()) {
    throw new XaiAuthError("Missing refresh token. Sign in with Grok again.", "xai_auth_missing_refresh", 401);
  }
  const discovery = await discoverXaiOidc(timeoutMs);
  const response = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: XAI_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 403) {
      throw new XaiAuthError(
        "Token refresh denied (HTTP 403). This SuperGrok tier may not allow API access — set XAI_API_KEY instead.",
        "xai_oauth_tier_denied",
        403
      );
    }
    throw new XaiAuthError(
      `Token refresh failed (${response.status}).${detail ? ` ${detail}` : ""} Sign in with Grok again.`,
      response.status === 400 || response.status === 401 ? "xai_refresh_relogin" : "xai_refresh_failed",
      response.status
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const tokens = parseTokenResponse(payload);
  return {
    ...tokens,
    refreshToken: tokens.refreshToken || refreshToken,
  };
}

export function accessTokenNeedsRefresh(expiresAt?: number): boolean {
  if (!expiresAt || !Number.isFinite(expiresAt)) return true;
  return expiresAt - XAI_ACCESS_TOKEN_REFRESH_SKEW_MS <= Date.now();
}

export function resolveXaiBaseUrl(override?: string): string {
  const raw = (override || process.env.XAI_BASE_URL || XAI_API_BASE_URL).trim().replace(/\/$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("bad protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return XAI_API_BASE_URL;
  }
}

/** Clear discovery cache (tests only). */
export function clearXaiDiscoveryCacheForTests() {
  discoveryCache = null;
}
