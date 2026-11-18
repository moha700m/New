import { adminRoute, redactProvider } from "@/lib/admin";
import { freshVersion } from "@/lib/config-bus";
import { prisma } from "@/lib/db";
import { getPublicCatalog, getRouting } from "@/lib/engine";
import { json } from "@/lib/http";
import { startOfDayUtc, startOfMonthUtc } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const day = startOfDayUtc();
  const month = startOfMonthUtc();
  const since24h = new Date(Date.now() - 864e5);
  const [users, newUsers, conversations, reqToday, errors24h, costMonth, tokensMonth, activeSubs, providers, routing, catalog, modelsTotal, modelsEnabled, revenueMonth] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: month } } }),
    prisma.conversation.count(),
    prisma.usageRecord.count({ where: { createdAt: { gte: day }, kind: { in: ["chat", "image"] } } }),
    prisma.usageRecord.count({ where: { createdAt: { gte: since24h }, status: "error" } }),
    prisma.usageRecord.aggregate({ where: { createdAt: { gte: month } }, _sum: { costUsd: true } }),
    prisma.usageRecord.aggregate({ where: { createdAt: { gte: month } }, _sum: { totalTokens: true } }),
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING"] } } }),
    prisma.provider.findMany({ orderBy: { priority: "asc" } }),
    getRouting(),
    getPublicCatalog(),
    prisma.aiModel.count(),
    prisma.aiModel.count({ where: { enabled: true } }),
    prisma.payment.aggregate({ where: { createdAt: { gte: month }, status: "paid" }, _sum: { amountCents: true } }),
  ]);
  const ids = [routing.defaultTextModelId, routing.fallbackModelId].filter(Boolean) as string[];
  const named = await prisma.aiModel.findMany({ where: { id: { in: ids } }, include: { provider: { select: { name: true } } } });
  const nameOf = (id: string | null) => {
    const m = named.find((x) => x.id === id);
    return m ? { id: m.id, name: m.displayName, modelId: m.modelId, provider: m.provider.name, enabled: m.enabled } : null;
  };
  const effectiveDefault = catalog.models.find((m) => m.id === catalog.defaults.text);
  return json({
    stats: {
      users, newUsers, conversations, requestsToday: reqToday, errors24h, activeSubscriptions: activeSubs,
      costMonthUsd: costMonth._sum.costUsd, tokensMonth: tokensMonth._sum.totalTokens ?? 0, revenueMonthCents: revenueMonth._sum.amountCents ?? 0,
      modelsTotal, modelsEnabled, customerVisibleModels: catalog.models.length,
    },
    engine: {
      configVersion: await freshVersion(),
      activeProvider: providers.find((p) => p.id === routing.defaultProviderId)?.name ?? null,
      defaultModel: nameOf(routing.defaultTextModelId),
      effectiveDefaultModel: effectiveDefault ? { id: effectiveDefault.id, name: effectiveDefault.name, provider: effectiveDefault.provider } : null,
      fallbackEnabled: routing.fallbackEnabled,
      fallbackProvider: providers.find((p) => p.id === routing.fallbackProviderId)?.name ?? null,
      fallbackModel: nameOf(routing.fallbackModelId),
    },
    providers: providers.map(redactProvider),
  });
});
