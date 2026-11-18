import "server-only";
import type { Plan } from "@prisma/client";
import { isOwnerAccount } from "./access";
import { prisma } from "./db";
import { HttpError } from "./http";

export async function getDefaultPlan(): Promise<Plan> {
  const p = (await prisma.plan.findFirst({ where: { isDefault: true } })) ?? (await prisma.plan.findFirst({ orderBy: { sortOrder: "asc" } }));
  if (!p) throw new HttpError(500, "لا توجد باقات اشتراك مُعدّة");
  return p;
}

/** Resolve the plan currently in effect for a user (expired/canceled subscriptions fall back to the default plan). */
/** The owner always gets the top plan with every limit removed and every feature on. */
async function ownerUnlimitedPlan(): Promise<Plan> {
  const top =
    (await prisma.plan.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "desc" }, { priceMonthlyCents: "desc" }] })) ??
    (await getDefaultPlan());
  return {
    ...top,
    name: `${top.name} (بلا حدود)`,
    dailyMessageLimit: null,
    monthlyMessageLimit: null,
    monthlyTokenLimit: null,
    maxUploadMb: Math.max(top.maxUploadMb, 100),
    allowUploads: true,
    allowWebSearch: true,
    allowImageGeneration: true,
    allowAllModels: true,
  };
}

export async function getUserPlan(userId: string) {
  const [sub, user] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } }),
  ]);
  if (user && isOwnerAccount(user)) return { plan: await ownerUnlimitedPlan(), subscription: sub };
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
    throw new HttpError(429, `وصلت للحد اليومي (${plan.dailyMessageLimit} رسالة) في باقة ${plan.name}. رقِّ باقتك للمزيد.`, "quota_daily");
  }
  if (plan.monthlyMessageLimit != null && u.messagesThisMonth >= plan.monthlyMessageLimit) {
    throw new HttpError(429, `وصلت للحد الشهري (${plan.monthlyMessageLimit} رسالة) في باقة ${plan.name}.`, "quota_monthly");
  }
  if (plan.monthlyTokenLimit != null && u.tokensThisMonth >= plan.monthlyTokenLimit) {
    throw new HttpError(429, `وصلت لحد التوكنز الشهري في باقة ${plan.name}.`, "quota_tokens");
  }
  return u;
}

/** Hosting platform request-body ceiling (Vercel functions accept ~4.5 MB bodies). */
export const PLATFORM_MAX_UPLOAD_MB = process.env.VERCEL ? 4 : 100;
export function effectiveUploadMb(plan: Plan) {
  return Math.min(plan.maxUploadMb, PLATFORM_MAX_UPLOAD_MB);
}
