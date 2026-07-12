import "server-only";
import { readFile } from "node:fs/promises";
import { XAI_OAUTH_CLIENT_ID, XAI_OAUTH_ISSUER } from "./constants";
import { accessTokenNeedsRefresh, refreshAccessToken, type XaiTokenSet } from "./oauth";

/**
 * Optional local import of Grok CLI credentials from ~/.grok/auth.json.
 * Enabled only when ALLOW_GROK_AUTH_IMPORT=true (trusted single-user hosts).
 */
export async function importGrokCliAuth(): Promise<XaiTokenSet | null> {
  if (process.env.ALLOW_GROK_AUTH_IMPORT !== "true") return null;

  const explicit = process.env.GROK_AUTH_PATH?.trim();
  const grokHome = process.env.GROK_HOME?.trim();
  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();

  // Keep paths explicit so the bundler does not NFT-trace the whole project.
  const authPath =
    explicit ||
    (grokHome ? `${grokHome.replace(/\/$/, "")}/auth.json` : "") ||
    (home ? `${home.replace(/\/$/, "")}/.grok/auth.json` : "");

  if (!authPath) return null;

  let raw: string;
  try {
    raw = await readFile(authPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const entries = parsed as Record<string, unknown>;
  const preferredKey = `${XAI_OAUTH_ISSUER}::${XAI_OAUTH_CLIENT_ID}`;
  const preferred = entries[preferredKey];
  const candidates = [
    preferred,
    ...Object.values(entries).filter((value) => value !== preferred),
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const accessToken = String(item.key ?? item.access_token ?? "").trim();
    const refreshToken = String(item.refresh_token ?? "").trim();
    if (!accessToken || !refreshToken) continue;

    let expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (typeof item.expires_at === "string" && item.expires_at) {
      const ms = Date.parse(item.expires_at);
      if (Number.isFinite(ms)) expiresAt = ms;
    }

    if (!accessTokenNeedsRefresh(expiresAt)) {
      return { accessToken, refreshToken, expiresAt, tokenType: "Bearer" };
    }
    try {
      return await refreshAccessToken(refreshToken);
    } catch {
      return { accessToken, refreshToken, expiresAt, tokenType: "Bearer" };
    }
  }
  return null;
}
