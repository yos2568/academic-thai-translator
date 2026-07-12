import { startDeviceCodeFlow, XaiAuthError } from "@/lib/xai/oauth";
import { allowRequest, requestIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!allowRequest(`xai-device:${ip}`, { capacity: 5, refillPerMinute: 5 })) {
    return Response.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, { status: 429 });
  }
  try {
    const start = await startDeviceCodeFlow();
    return Response.json({
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresIn: start.expiresIn,
      interval: start.interval,
    });
  } catch (error) {
    const message =
      error instanceof XaiAuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not start Grok sign-in.";
    return Response.json({ error: message }, { status: 502 });
  }
}
