import { describe, expect, it } from "vitest";
import { clamp, hasMagicBytes } from "./util";

describe("hasMagicBytes", () => {
  it("matches a buffer whose leading bytes equal the signature", () => {
    expect(hasMagicBytes(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), [0x25, 0x50, 0x44, 0x46])).toBe(true);
  });

  it("rejects a buffer with a different signature", () => {
    expect(hasMagicBytes(Buffer.from([0x00, 0x01, 0x02]), [0x25, 0x50, 0x44, 0x46])).toBe(false);
  });

  it("rejects a buffer shorter than the signature", () => {
    expect(hasMagicBytes(Buffer.from([0x25, 0x50]), [0x25, 0x50, 0x44, 0x46])).toBe(false);
  });

  it("matches an exact-length buffer", () => {
    expect(hasMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]), [0x50, 0x4b, 0x03, 0x04])).toBe(true);
  });
});

describe("clamp", () => {
  it("returns the value unchanged when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
