import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOAuthTokenCacheForTests, oauthOpenAiCompatibleEngine } from "./oauth-openai-compatible";
import type { OAuthOpenAiCompatibleConfig } from "./oauth-openai-compatible";

const baseConfig: OAuthOpenAiCompatibleConfig = {
  provider: "oauth-openai-compatible",
  baseUrl: "https://api.example.com/v1",
  model: "test-model",
  tokenUrl: "https://auth.example.com/oauth/token",
  clientId: "client-abc",
  clientSecret: "super-secret-value",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("oauthOpenAiCompatibleEngine", () => {
  const originalFlag = process.env.ALLOW_PRIVATE_UPSTREAMS;

  beforeEach(() => {
    // The SSRF guard does a real DNS lookup on the host; bypass it here
    // the same way scripts/smoke-test.mjs does for its local stub.
    process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
    clearOAuthTokenCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS;
    else process.env.ALLOW_PRIVATE_UPSTREAMS = originalFlag;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("acquires a token and uses it as a bearer credential for the chat call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 300 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "สวัสดี" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await oauthOpenAiCompatibleEngine.generate(baseConfig, { system: "s", prompt: "p" });

    expect(result).toBe("สวัสดี");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenCall, chatCall] = fetchMock.mock.calls;
    expect(tokenCall[0]).toBe(baseConfig.tokenUrl);
    expect(chatCall[1].headers.Authorization).toBe("Bearer token-1");
  });

  it("reuses a cached token across calls instead of re-requesting it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 300 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "one" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "two" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthOpenAiCompatibleEngine.generate(baseConfig, { system: "s", prompt: "p1" });
    await oauthOpenAiCompatibleEngine.generate(baseConfig, { system: "s", prompt: "p2" });

    // 1 token request + 2 chat requests, not 2 token requests + 2 chat requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes the token once it is within the expiry safety margin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "one" } }] }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-2", expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "two" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthOpenAiCompatibleEngine.generate(baseConfig, { system: "s", prompt: "p1" });
    vi.setSystemTime(45_000); // within the 30s refresh margin of a 60s token
    await oauthOpenAiCompatibleEngine.generate(baseConfig, { system: "s", prompt: "p2" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const secondChatCall = fetchMock.mock.calls[3];
    expect(secondChatCall[1].headers.Authorization).toBe("Bearer token-2");
  });

  it("never includes the client secret or the resolved token in a failure message", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 401));
    vi.stubGlobal("fetch", fetchMock);

    const result = await oauthOpenAiCompatibleEngine.test(baseConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(baseConfig.clientSecret);
    expect(result.error).not.toContain("token-1");
  });

  it("surfaces a clear error when the token endpoint returns no access_token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await oauthOpenAiCompatibleEngine.test(baseConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid response/i);
  });
});
