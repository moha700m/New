import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";

const schema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  disabled: z.boolean().optional(),
  verifyEmail: z.boolean().optional(),
  /** Manually grant a plan (comp / support). null removes a manual grant. */
  grantPlanKey: z.string().max(40).nullable().optional(),
  grantDays: z.number().int().min(1).max(3650).optional(),
});

export const PATCH = adminRoute<{ id: string }>(async ({ req, params, user, log }) => {
  const body = await parseBody(req, schema);
  const target = await prisma.user.findUnique({ where: { id: params.id }, include: { subscription: true } });
  if (!target) throw new HttpError(404, "المستخدم غير موجود");
  if (target.role === "OWNER") throw new HttpError(403, "لا يمكن تعديل حساب المالك");
  if (body.role && user.role !== "OWNER") throw new HttpError(403, "المالك فقط يمكنه تغيير الأدوار");
  if (target.id === user.id && (body.disabled || body.role)) throw new HttpError(400, "لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك");
  await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(body.role ? { role: body.role } : {}),
      ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      ...(body.verifyEmail ? { emailVerifiedAt: new Date() } : {}),
    },
  });
  if (body.disabled) await prisma.session.deleteMany({ where: { userId: target.id } });
  if (body.grantPlanKey !== undefined) {
    if (target.subscription?.providerSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(target.subscription.status)) {
      throw new HttpError(400, "لدى المستخدم اشتراك مدفوع يديره مزوّد الدفع؛ غيّره من هناك.");
    }
    if (body.grantPlanKey === null) {
      await prisma.subscription.deleteMany({ where: { userId: target.id, providerSubscriptionId: null } });
    } else {
      const plan = await prisma.plan.findUnique({ where: { key: body.grantPlanKey } });
      if (!plan) throw new HttpError(404, "الباقة غير موجودة");
      const end = new Date(Date.now() + (body.grantDays ?? 30) * 864e5);
      await prisma.subscription.upsert({
        where: { userId: target.id },
        create: { userId: target.id, planId: plan.id, status: "ACTIVE", provider: "manual", currentPeriodStart: new Date(), currentPeriodEnd: end },
        update: { planId: plan.id, status: "ACTIVE", provider: "manual", providerSubscriptionId: null, currentPeriodStart: new Date(), currentPeriodEnd: end, cancelAtPeriodEnd: false },
      });
    }
  }
  await log("user.update", { entityType: "user", entityId: target.id, details: { email: target.email, ...body } });
  return json({ ok: true });
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, user, log }) => {
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw new HttpError(404, "المستخدم غير موجود");
  if (target.role === "OWNER" || target.id === user.id) throw new HttpError(403, "لا يمكن حذف هذا الحساب");
  if (target.role === "ADMIN" && user.role !== "OWNER") throw new HttpError(403, "المالك فقط يمكنه حذف المسؤولين");
  await prisma.user.delete({ where: { id: target.id } });
  await log("user.delete", { entityType: "user", entityId: target.id, details: { email: target.email } });
  return json({ ok: true });
});
