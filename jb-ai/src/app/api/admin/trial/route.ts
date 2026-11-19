import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json, parseBody } from "@/lib/http";
import { mailerConfigured } from "@/lib/mailer";
import { getTrialSettings, saveTrialSettings, trialSpendToday } from "@/lib/trial";

export const dynamic = "force-dynamic";

/** Free-trial admin: settings, today's trial spend vs cap, trial/upgraded users, candidate (cheap uncensored) models. */
export const GET = adminRoute(async () => {
  const [settings, spend, users, models] = await Promise.all([
    getTrialSettings(),
    trialSpendToday(),
    prisma.user.findMany({
      where: { access: { in: ["trial", "full"] } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, email: true, name: true, access: true, trialUsed: true, emailVerifiedAt: true, disabled: true, createdAt: true, signupIp: true },
    }),
    prisma.aiModel.findMany({
      where: { enabled: true, supportsText: true, supportsImageGeneration: false, provider: { type: "VENICE", enabled: true }, NOT: { modelId: { startsWith: "e2ee-" } } },
      select: { id: true, modelId: true, displayName: true, inputPricePerM: true, outputPricePerM: true, extraCapabilities: true },
      orderBy: { outputPricePerM: "asc" },
    }),
  ]);
  const uncensored = models.filter((m) => (m.extraCapabilities as { uncensored?: boolean } | null)?.uncensored || /uncensored|heretic|abliterat/i.test(m.modelId));
  const ids = users.map((u) => u.id);
  const spendByUser = ids.length
    ? await prisma.usageRecord.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _sum: { costUsd: true } })
    : [];
  return json({
    settings,
    mailerConfigured: mailerConfigured(),
    today: { spendUsd: spend.usd, requests: spend.requests, capUsd: settings.dailyCapUsd },
    users: users.map((u) => ({ ...u, signupIp: u.signupIp ? u.signupIp.replace(/\.\d+$/, ".x") : null, spentUsd: spendByUser.find((s) => s.userId === u.id)?._sum.costUsd ?? 0 })),
    models: uncensored.map(({ extraCapabilities: _e, ...m }) => m),
  });
});

const schema = z.object({
  enabled: z.boolean().optional(),
  requireVerification: z.boolean().optional(),
  messages: z.number().int().min(0).max(100).optional(),
  dailyCapUsd: z.number().min(0).max(100).optional(),
  maxOutputTokens: z.number().int().min(100).max(8000).optional(),
  historyMessages: z.number().int().min(1).max(40).optional(),
  maxInputChars: z.number().int().min(500).max(50000).optional(),
  models: z.array(z.string().max(200)).max(20).optional(),
  labels: z.record(z.string().max(200), z.object({ name: z.string().max(40), desc: z.string().max(160) })).optional(),
  listTitle: z.string().max(60).optional(),
  priceUsd: z.number().min(0).max(10000).optional(),
  creditLabel: z.string().max(80).optional(),
  telegramUrl: z.string().url().max(200).refine((u) => u.startsWith("https://"), "https only").optional(),
});

export const PUT = adminRoute(async ({ req, log, publish }) => {
  const body = await parseBody(req, schema);
  const next = await saveTrialSettings(body);
  await log("trial.settings", { details: body as Record<string, unknown> });
  await publish();
  return json({ settings: next });
});
