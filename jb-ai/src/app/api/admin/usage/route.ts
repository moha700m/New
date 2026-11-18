import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req }) => {
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") || 14)));
  const since = new Date(Date.now() - days * 864e5);
  const [daily, byModel, byProvider, errors, totals] = await Promise.all([
    prisma.$queryRaw<{ day: Date; requests: bigint; errors: bigint; tokens: bigint | null; cost: number | null }[]>`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS requests,
             count(*) FILTER (WHERE status = 'error') AS errors,
             sum("totalTokens") AS tokens, sum("costUsd") AS cost
      FROM "UsageRecord" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.usageRecord.groupBy({ by: ["modelKey"], where: { createdAt: { gte: since } }, _count: true, _sum: { totalTokens: true, costUsd: true, promptTokens: true, completionTokens: true }, orderBy: { _count: { modelKey: "desc" } }, take: 30 }),
    prisma.usageRecord.groupBy({ by: ["providerId"], where: { createdAt: { gte: since } }, _count: true, _sum: { totalTokens: true, costUsd: true }, _avg: { latencyMs: true } }),
    prisma.usageRecord.findMany({ where: { createdAt: { gte: since }, status: "error" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, createdAt: true, modelKey: true, errorMessage: true, usedFallback: true, kind: true, provider: { select: { name: true } }, user: { select: { email: true } } } }),
    prisma.usageRecord.aggregate({ where: { createdAt: { gte: since } }, _count: true, _sum: { totalTokens: true, costUsd: true } }),
  ]);
  const costSources = await prisma.usageRecord.groupBy({ by: ["costSource"], where: { createdAt: { gte: since } }, _count: true, _sum: { costUsd: true } });
  const providers = await prisma.provider.findMany({ select: { id: true, name: true } });
  return json({
    days,
    totals: { requests: totals._count, tokens: totals._sum.totalTokens ?? 0, costUsd: totals._sum.costUsd },
    costSources: costSources.map((c) => ({ source: c.costSource ?? "unreported", requests: c._count, costUsd: c._sum.costUsd })),
    daily: daily.map((d) => ({ day: d.day, requests: Number(d.requests), errors: Number(d.errors), tokens: d.tokens == null ? 0 : Number(d.tokens), cost: d.cost })),
    byModel: byModel.map((m) => ({ modelKey: m.modelKey, requests: m._count, tokens: m._sum.totalTokens ?? 0, promptTokens: m._sum.promptTokens ?? 0, completionTokens: m._sum.completionTokens ?? 0, costUsd: m._sum.costUsd })),
    byProvider: byProvider.map((p) => ({ provider: providers.find((x) => x.id === p.providerId)?.name ?? "(deleted)", requests: p._count, tokens: p._sum.totalTokens ?? 0, costUsd: p._sum.costUsd, avgLatencyMs: p._avg.latencyMs ? Math.round(p._avg.latencyMs) : null })),
    errors,
  });
});
