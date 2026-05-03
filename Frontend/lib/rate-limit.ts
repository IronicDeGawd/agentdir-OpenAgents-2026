import "server-only";

// Tiny fixed-window in-memory rate limiter. Per-IP counters reset every
// `windowMs`. Good enough to stop trivial abuse on a single-instance demo;
// swap for Upstash/Vercel KV if scaling out.

type Bucket = { count: number; resetAt: number };

const BUCKETS = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    if (BUCKETS.size >= MAX_BUCKETS) gc(now);
    const resetAt = now + windowMs;
    BUCKETS.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

function gc(now: number) {
  for (const [k, v] of BUCKETS) {
    if (v.resetAt <= now) BUCKETS.delete(k);
    if (BUCKETS.size < MAX_BUCKETS / 2) break;
  }
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
