import "server-only";
import type { Plan } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";

export async function getDefaultPlan(): Promise<Plan> {
  const p = (await prisma.plan.findFirst({ where: { isDefault: true } })) ?? (await prisma.plan.findFirst({ orderBy: { sortOrder: "asc" } }));
  if (!p) throw new HttpError(500, "No subscription plans are configured");
  return p;
}

/** Resolve the plan currently in effect for a user (expired/canceled subscriptions fall back to the default plan). */
export async function getUserPlan(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
  const now = new Date();
  if (sub && (sub.status === "ACTIVE" || sub.status === "TRIALING" || sub.status === "PAST_DUE")) {
    if (!sub.currentPeriodEnd || sub.currentPeriodEnd > now) return { plan: sub.plan, subscription: sub };
    // period ended without renewal webhook → expire
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
  }
  return { plan: await getDefaultPlan(), subscription: sub };
}

export async function planAllowsModel(plan: Plan, modelRowId: string) {
  if (plan.allowAllModels) return true;
  const row = await prisma.planModel.findUnique({ where: { planId_modelId: { planId: plan.id, modelId: modelRowId } } });
  return Boolean(row);
}

export function startOfDayUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function startOfMonthUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function usageSummary(userId: string) {
  const [day, month, tokens] = await Promise.all([
    prisma.usageRecord.count({ where: { userId, kind: { in: ["chat", "image"] }, status: { not: "error" }, createdAt: { gte: startOfDayUtc() } } }),
    prisma.usageRecord.count({ where: { userId, kind: { in: ["chat", "image"] }, status: { not: "error" }, createdAt: { gte: startOfMonthUtc() } } }),
    prisma.usageRecord.aggregate({ where: { userId, createdAt: { gte: startOfMonthUtc() } }, _sum: { totalTokens: true } }),
  ]);
  return { messagesToday: day, messagesThisMonth: month, tokensThisMonth: tokens._sum.totalTokens ?? 0 };
}

export async function enforceQuota(userId: string, plan: Plan) {
  const u = await usageSummary(userId);
  if (plan.dailyMessageLimit != null && u.messagesToday >= plan.dailyMessageLimit) {
    throw new HttpError(429, `Daily limit of ${plan.dailyMessageLimit} messages reached on the ${plan.name} plan. Upgrade for more.`, "quota_daily");
  }
  if (plan.monthlyMessageLimit != null && u.messagesThisMonth >= plan.monthlyMessageLimit) {
    throw new HttpError(429, `Monthly limit of ${plan.monthlyMessageLimit} messages reached on the ${plan.name} plan.`, "quota_monthly");
  }
  if (plan.monthlyTokenLimit != null && u.tokensThisMonth >= plan.monthlyTokenLimit) {
    throw new HttpError(429, `Monthly token allowance reached on the ${plan.name} plan.`, "quota_tokens");
  }
  return u;
}
