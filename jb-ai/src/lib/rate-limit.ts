import "server-only";
import { prisma } from "./db";
import { HttpError } from "./http";

/**
 * Fixed-window rate limiter stored in Postgres, so limits hold across serverless instances
 * (Vercel) and multiple servers. Plan quotas are enforced separately from usage records.
 */
export async function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await prisma.rateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (Math.random() < 0.01) {
    void prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 864e5) } } }).catch(() => {});
  }
  if (row.count > limit) {
    const retry = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    throw new HttpError(429, `طلبات كثيرة. حاول مرة أخرى بعد ${retry} ثانية.`, "rate_limited");
  }
}
