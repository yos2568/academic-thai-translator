import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearXaiOauthTokenCacheForTests, xaiEngine, xaiOauthEngine } from "./xai";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("xai engines", () => {
  const originalFlag = process.env.ALLOW_PRIVATE_UPSTREAMS;

  beforeEach(() => {
    process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
    clearXaiOauthTokenCacheForTests();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS;
    else process.env.ALLOW_PRIVATE_UPSTREAMS = originalFlag;
    vi.unstubAllGlobals();
  });

  it("calls chat completions with API key bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "สวัสดี" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await xaiEngine.generate(
      { provider: "xai", apiKey: "xai-test", model: "grok-4.5", baseUrl: "https://api.x.ai/v1" },
      { system: "s", prompt: "p" }
    );
    expect(text).toBe("สวัสดี");
    expect(fetchMock.mock.calls[0][0]).toContain("/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer xai-test");
  });

  it("refreshes oauth token then calls chat completions", async () => {
    const fetchMock = vi
      .fn()
      // discovery
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
          token_endpoint: "https://auth.x.ai/oauth2/token",
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        })
      )
      // refresh
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "refresh-1",
          expires_in: 3600,
        })
      )
      // chat
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ไทย" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await xaiOauthEngine.generate(
      {
        provider: "xai-oauth",
        model: "grok-4.5",
        refreshToken: "refresh-1",
        expiresAt: 1, // force refresh
        baseUrl: "https://api.x.ai/v1",
      },
      { system: "s", prompt: "p" }
    );
    expect(text).toBe("ไทย");
    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/chat/completions"));
    expect(chatCall?.[1].headers.Authorization).toBe("Bearer new-access");
  });
});
