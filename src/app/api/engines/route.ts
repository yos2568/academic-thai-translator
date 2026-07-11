import { envPipelineConfig, publicProvider, validateProvider } from "@/lib/providers";
import { testProvider } from "@/lib/engines";
import { allowRequest, requestIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET() {
  const config = envPipelineConfig();
  return Response.json({ configured: Boolean(config), draft: config ? publicProvider(config.draft) : null });
}

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!allowRequest(`engines:${ip}`, { capacity: 10, refillPerMinute: 10 })) {
    return Response.json(
      { ok: false, error: "Too many provider tests. Please wait a minute and try again." },
      { status: 429 }
    );
  }
  try {
    const config = validateProvider(await request.json());
    const result = await testProvider(config);
    return Response.json({ provider: config.provider, ...result }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid configuration." }, { status: 400 });
  }
}
