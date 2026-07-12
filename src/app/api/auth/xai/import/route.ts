import { importGrokCliAuth } from "@/lib/xai/local-auth";
import { XAI_DEFAULT_MODEL } from "@/lib/xai/constants";
import { allowRequest, requestIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Import tokens from the local Grok CLI (~/.grok/auth.json).
 * Requires ALLOW_GROK_AUTH_IMPORT=true on a trusted machine.
 */
export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!allowRequest(`xai-import:${ip}`, { capacity: 5, refillPerMinute: 5 })) {
    return Response.json({ error: "Too many import attempts." }, { status: 429 });
  }

  if (process.env.ALLOW_GROK_AUTH_IMPORT !== "true") {
    return Response.json(
      {
        error:
          "Local Grok CLI import is disabled. Set ALLOW_GROK_AUTH_IMPORT=true on a trusted host, or use Sign in with Grok.",
      },
      { status: 403 }
    );
  }

  try {
    const tokens = await importGrokCliAuth();
    if (!tokens) {
      return Response.json(
        { error: "No usable Grok CLI credentials found. Run `grok login` first." },
        { status: 404 }
      );
    }
    return Response.json({
      provider: {
        provider: "xai-oauth",
        model: process.env.XAI_MODEL || XAI_DEFAULT_MODEL,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Import failed." },
      { status: 500 }
    );
  }
}
