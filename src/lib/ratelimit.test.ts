import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowRequest, clearRateLimitsForTests, requestIp } from "./ratelimit";

describe("allowRequest", () => {
  beforeEach(() => {
    clearRateLimitsForTests();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to capacity, then rejects", () => {
    const opts = { capacity: 3, refillPerMinute: 1 };
    expect(allowRequest("a", opts)).toBe(true);
    expect(allowRequest("a", opts)).toBe(true);
    expect(allowRequest("a", opts)).toBe(true);
    expect(allowRequest("a", opts)).toBe(false);
  });

  it("tracks separate buckets per key", () => {
    const opts = { capacity: 1, refillPerMinute: 1 };
    expect(allowRequest("x", opts)).toBe(true);
    expect(allowRequest("y", opts)).toBe(true);
    expect(allowRequest("x", opts)).toBe(false);
    expect(allowRequest("y", opts)).toBe(false);
  });

  it("refills tokens over time", () => {
    const opts = { capacity: 2, refillPerMinute: 2 };
    expect(allowRequest("refill", opts)).toBe(true);
    expect(allowRequest("refill", opts)).toBe(true);
    expect(allowRequest("refill", opts)).toBe(false);

    vi.setSystemTime(30_000); // 30s later, refillPerMinute=2 -> +1 token
    expect(allowRequest("refill", opts)).toBe(true);
    expect(allowRequest("refill", opts)).toBe(false);
  });

  it("does not exceed capacity even after a long idle period", () => {
    const opts = { capacity: 2, refillPerMinute: 5 };
    expect(allowRequest("cap", opts)).toBe(true);
    vi.setSystemTime(10 * 60_000); // 10 minutes later
    expect(allowRequest("cap", opts)).toBe(true);
    expect(allowRequest("cap", opts)).toBe(true);
    expect(allowRequest("cap", opts)).toBe(false);
  });

  it("clearRateLimitsForTests resets all bucket state", () => {
    const opts = { capacity: 1, refillPerMinute: 1 };
    expect(allowRequest("reset-me", opts)).toBe(true);
    expect(allowRequest("reset-me", opts)).toBe(false);
    clearRateLimitsForTests();
    expect(allowRequest("reset-me", opts)).toBe(true);
  });
});

describe("requestIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
    });
    expect(requestIp(request)).toBe("203.0.113.4");
  });

  it("falls back to 'local' when the header is absent", () => {
    const request = new Request("http://localhost");
    expect(requestIp(request)).toBe("local");
  });
});
