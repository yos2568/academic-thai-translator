import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertPublicHost, isPrivateAddress } from "./net-guard";

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["10.0.0.0", true],
    ["10.255.255.255", true],
    ["172.16.0.0", true],
    ["172.31.255.255", true],
    ["172.15.255.255", false],
    ["172.32.0.0", false],
    ["192.168.0.0", true],
    ["192.168.255.255", true],
    ["169.254.169.254", true],
    ["169.254.0.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["::", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.5", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
    ["2606:4700:4700::1111", false],
  ])("classifies %s as private=%s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe("assertPublicHost", () => {
  const originalFlag = process.env.ALLOW_PRIVATE_UPSTREAMS;

  beforeEach(() => {
    delete process.env.ALLOW_PRIVATE_UPSTREAMS;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ALLOW_PRIVATE_UPSTREAMS;
    else process.env.ALLOW_PRIVATE_UPSTREAMS = originalFlag;
  });

  it("rejects a loopback IP literal", async () => {
    await expect(assertPublicHost("http://127.0.0.1:11434")).rejects.toThrow(/private or local/i);
  });

  it("rejects a cloud metadata IP literal", async () => {
    await expect(assertPublicHost("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private or local/i);
  });

  it("rejects a link-local IPv6 literal", async () => {
    await expect(assertPublicHost("http://[fe80::1]")).rejects.toThrow(/private or local/i);
  });

  it("rejects a non-http(s) protocol", async () => {
    await expect(assertPublicHost("file:///etc/passwd")).rejects.toThrow(/http/i);
  });

  it("rejects an unparsable URL", async () => {
    await expect(assertPublicHost("not a url")).rejects.toThrow();
  });

  it("allows a public IP literal", async () => {
    await expect(assertPublicHost("http://8.8.8.8")).resolves.toBeUndefined();
  });

  it("skips all checks when ALLOW_PRIVATE_UPSTREAMS=true", async () => {
    process.env.ALLOW_PRIVATE_UPSTREAMS = "true";
    await expect(assertPublicHost("http://127.0.0.1:11434")).resolves.toBeUndefined();
    await expect(assertPublicHost("http://169.254.169.254")).resolves.toBeUndefined();
  });
});
