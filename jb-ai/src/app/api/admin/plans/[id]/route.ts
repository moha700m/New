import { adminRoute } from "@/lib/admin";
import { planSchema } from "@/lib/admin-schemas";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";

export const PUT = adminRoute<{ id: string }>(async ({ req, params, log, publish }) => {
  const { modelIds, ...body } = await parseBody(req, planSchema);
  const cur = await prisma.plan.findUnique({ where: { id: params.id } });
  if (!cur) throw new HttpError(404, "الباقة غير موجودة");
  if (body.key !== cur.key && (await prisma.plan.findUnique({ where: { key: body.key } }))) throw new HttpError(409, "معرّف الباقة مستخدم مسبقًا");
  if (body.isDefault) await prisma.plan.updateMany({ where: { id: { not: cur.id } }, data: { isDefault: false } });
  if (cur.isDefault && body.isDefault === false) throw new HttpError(400, "اختر باقة افتراضية أخرى أولًا (يجب أن تكون هناك باقة مجانية افتراضية).");
  const plan = await prisma.$transaction(async (tx) => {
    if (modelIds) {
      await tx.planModel.deleteMany({ where: { planId: cur.id } });
      if (modelIds.length) await tx.planModel.createMany({ data: modelIds.map((modelId) => ({ planId: cur.id, modelId })), skipDuplicates: true });
    }
    return tx.plan.update({ where: { id: cur.id }, data: body });
  });
  await log("plan.update", { entityType: "plan", entityId: plan.id, details: { key: plan.key, modelCount: modelIds?.length } });
  await publish();
  return json({ plan });
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, log, publish }) => {
  const p = await prisma.plan.findUnique({ where: { id: params.id }, include: { _count: { select: { subscriptions: true } } } });
  if (!p) throw new HttpError(404, "الباقة غير موجودة");
  if (p.isDefault) throw new HttpError(400, "لا يمكن حذف الباقة الافتراضية");
  if (p._count.subscriptions) throw new HttpError(400, "هذه الباقة عليها مشتركون. عطّلها بدلًا من حذفها.");
  await prisma.plan.delete({ where: { id: p.id } });
  await log("plan.delete", { entityType: "plan", entityId: p.id, details: { key: p.key } });
  await publish();
  return json({ ok: true });
});
