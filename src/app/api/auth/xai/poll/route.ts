import { pollDeviceCode, XaiAuthError } from "@/lib/xai/oauth";
import { XAI_DEFAULT_MODEL } from "@/lib/xai/constants";
import { allowRequest, requestIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!allowRequest(`xai-poll:${ip}`, { capacity: 60, refillPerMinute: 60 })) {
    return Response.json({ error: "Too many poll requests." }, { status: 429 });
  }

  let deviceCode = "";
  try {
    const body = await request.json();
    deviceCode = typeof body?.deviceCode === "string" ? body.deviceCode.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!deviceCode) return Response.json({ error: "deviceCode is required." }, { status: 400 });

  try {
    const result = await pollDeviceCode(deviceCode);
    if (result.status === "ready") {
      return Response.json({
        status: "ready",
        provider: {
          provider: "xai-oauth",
          model: process.env.XAI_MODEL || XAI_DEFAULT_MODEL,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: result.tokens.expiresAt,
        },
      });
    }
    if (result.status === "slow_down") {
      return Response.json({ status: "slow_down", interval: result.interval });
    }
    if (result.status === "pending") {
      return Response.json({ status: "pending" });
    }
    return Response.json({ status: result.status, error: result.error }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof XaiAuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Sign-in poll failed.";
    const status = error instanceof XaiAuthError && error.status === 403 ? 403 : 502;
    return Response.json({ error: message }, { status });
  }
}
