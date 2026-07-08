/**
 * Minimal in-memory sliding-window rate limiter for abuse control on public
 * endpoints. Per-process only (each serverless instance counts separately),
 * which is fine as a spam brake — it bounds the damage without external state.
 */

const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitOptions = {
  /** Maximum allowed events per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export function isRateLimited(key: string, { limit, windowMs }: RateLimitOptions, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }

  // Bound memory if a scan spreads across many source addresses.
  if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) {
    buckets.clear();
  }

  recent.push(now);
  buckets.set(key, recent);

  return false;
}

/** Best-effort client key: first hop of x-forwarded-for, else a shared bucket. */
export function clientKeyForRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",")[0]?.trim();

  return firstHop || "unknown-client";
}

/** Test hook: reset limiter state between cases. */
export function resetRateLimiter() {
  buckets.clear();
}
