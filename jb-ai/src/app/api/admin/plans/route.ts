import { adminRoute } from "@/lib/admin";
import { planSchema } from "@/lib/admin-schemas";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { models: { select: { modelId: true } }, _count: { select: { subscriptions: true } } } });
  return json({ plans: plans.map(({ models, _count, ...p }) => ({ ...p, modelIds: models.map((m) => m.modelId), subscriberCount: _count.subscriptions })) });
});

export const POST = adminRoute(async ({ req, log, publish }) => {
  const { modelIds, ...body } = await parseBody(req, planSchema);
  if (await prisma.plan.findUnique({ where: { key: body.key } })) throw new HttpError(409, "Plan key already exists");
  if (body.isDefault) await prisma.plan.updateMany({ data: { isDefault: false } });
  const plan = await prisma.plan.create({ data: { ...body, ...(modelIds ? { models: { create: modelIds.map((modelId) => ({ modelId })) } } : {}) } });
  await log("plan.create", { entityType: "plan", entityId: plan.id, details: { key: plan.key } });
  await publish();
  return json({ plan }, 201);
});
