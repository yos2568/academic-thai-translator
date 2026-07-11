import "server-only";

export interface Bucket {
  tokens: number;
  last: number;
  capacity: number;
  refillPerMinute: number;
}

/**
 * Storage for rate-limit buckets. The default MemoryRateLimitStore is
 * process-local: every app replica has its own independent limits, which is
 * fine for the single-instance Docker/Caddy deployment this app targets. A
 * multi-instance deployment should implement this interface against shared
 * state (e.g. Redis, keyed the same way) and call setRateLimitStore() once
 * at startup; no caller of allowRequest()/requestIp() needs to change.
 */
export interface RateLimitStore {
  get(key: string): Bucket | undefined;
  set(key: string, bucket: Bucket): void;
  clear(): void;
}

const MAX_BUCKETS = 10_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  get(key: string): Bucket | undefined {
    return this.buckets.get(key);
  }

  set(key: string, bucket: Bucket): void {
    if (!this.buckets.has(key)) this.evictOldestIfFull();
    this.buckets.set(key, bucket);
  }

  clear(): void {
    this.buckets.clear();
  }

  private evictOldestIfFull(): void {
    if (this.buckets.size < MAX_BUCKETS) return;
    let oldestKey: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.last < oldestTime) {
        oldestKey = key;
        oldestTime = bucket.last;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export function allowRequest(
  key: string,
  opts: { capacity: number; refillPerMinute: number }
): boolean {
  const now = Date.now();
  const existing = store.get(key);
  const bucket: Bucket =
    existing && existing.capacity === opts.capacity && existing.refillPerMinute === opts.refillPerMinute
      ? existing
      : { tokens: opts.capacity, last: now, ...opts };

  bucket.tokens = Math.min(
    opts.capacity,
    bucket.tokens + ((now - bucket.last) / 60_000) * opts.refillPerMinute
  );
  bucket.last = now;

  if (bucket.tokens < 1) {
    store.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  store.set(key, bucket);
  return true;
}

export function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function clearRateLimitsForTests(): void {
  store.clear();
}
