import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_UPSTREAM_ERROR =
  "Private or local provider addresses are blocked. Set ALLOW_PRIVATE_UPSTREAMS=true only on a trusted deployment to enable them.";

function blockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function firstIpv6Hextet(address: string): number | null {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return 0;
  const first = normalized.split(":")[0];
  if (!first) return null;
  const value = Number.parseInt(first, 16);
  return Number.isNaN(value) ? null : value;
}

function mappedIpv4(address: string): string | null {
  const match = address.toLowerCase().split("%")[0].match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (match) return match[1];

  const hexMatch = address.toLowerCase().split("%")[0].match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMatch) return null;
  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) return blockedIpv4(address);
  if (family !== 6) return true;

  const mapped = mappedIpv4(address);
  if (mapped) return blockedIpv4(mapped);
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  const first = firstIpv6Hextet(normalized);
  return first === null || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

export async function assertPublicHost(url: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_UPSTREAMS === "true") return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Provider URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider URL must use HTTP or HTTPS.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address);

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(PRIVATE_UPSTREAM_ERROR);
  }
}
