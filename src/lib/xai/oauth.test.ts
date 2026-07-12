import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearXaiDiscoveryCacheForTests,
  pollDeviceCode,
  refreshAccessToken,
  startDeviceCodeFlow,
} from "./oauth";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const discovery = {
  authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
  token_endpoint: "https://auth.x.ai/oauth2/token",
  device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
};

describe("xai oauth", () => {
  beforeEach(() => {
    clearXaiDiscoveryCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a device-code flow", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://auth.x.ai/device",
          verification_uri_complete: "https://auth.x.ai/device?user_code=ABCD-EFGH",
          expires_in: 900,
          interval: 5,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const start = await startDeviceCodeFlow();
    expect(start.userCode).toBe("ABCD-EFGH");
    expect(start.deviceCode).toBe("dev-1");
    expect(start.verificationUri).toContain("auth.x.ai");
  });

  it("polls until tokens are ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(
        jsonResponse({ error: "authorization_pending" }, false, 400)
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = await pollDeviceCode("dev-1");
    expect(pending.status).toBe("pending");

    const ready = await pollDeviceCode("dev-1");
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") {
      expect(ready.tokens.accessToken).toBe("access-1");
      expect(ready.tokens.refreshToken).toBe("refresh-1");
    }
  });

  it("refreshes access tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshAccessToken("refresh-1");
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-2");
  });
});
