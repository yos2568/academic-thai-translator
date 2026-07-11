import "server-only";

interface Bucket {
  tokens: number;
  last: number;
  capacity: number;
  refillPerMinute: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function evictOldest(): void {
  if (buckets.size < MAX_BUCKETS) return;
  let oldestKey: string | undefined;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.last < oldestTime) {
      oldestKey = key;
      oldestTime = bucket.last;
    }
  }
  if (oldestKey) buckets.delete(oldestKey);
}

export function allowRequest(
  key: string,
  opts: { capacity: number; refillPerMinute: number }
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
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
    buckets.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  if (!buckets.has(key)) evictOldest();
  buckets.set(key, bucket);
  return true;
}

export function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function clearRateLimitsForTests(): void {
  buckets.clear();
}
