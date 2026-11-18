import { HttpError } from "./http";

/**
 * Sliding-window in-memory rate limiter (per server instance).
 * Plan quotas (daily/monthly limits) are enforced separately against the database.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retry = Math.ceil((windowMs - (now - arr[0]!)) / 1000);
    throw new HttpError(429, `Too many requests. Try again in ${retry}s.`, "rate_limited");
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1]! > windowMs) buckets.delete(k);
  }
}
