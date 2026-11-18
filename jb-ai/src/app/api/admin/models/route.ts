import { adminRoute } from "@/lib/admin";
import { modelCreateSchema } from "@/lib/admin-schemas";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { setModelPlans } from "@/lib/model-admin";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const providerId = sp.get("providerId") || undefined;
  const q = sp.get("q")?.trim();
  const status = sp.get("status"); // enabled | disabled | all
  const category = sp.get("category") || undefined;
  const models = await prisma.aiModel.findMany({
    where: {
      providerId,
      ...(category ? { category: category as never } : {}),
      ...(status === "enabled" ? { enabled: true } : status === "disabled" ? { enabled: false } : {}),
      ...(q ? { OR: [{ modelId: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { provider: { select: { id: true, name: true, enabled: true } }, plans: { include: { plan: { select: { key: true } } } } },
    orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }, { displayName: "asc" }],
    take: 1000,
  });
  return json({
    models: models.map(({ rawMetadata: _r, plans, ...m }) => ({ ...m, planKeys: plans.map((p) => p.plan.key) })),
  });
});

export const POST = adminRoute(async ({ req, log, publish }) => {
  const { planKeys, ...body } = await parseBody(req, modelCreateSchema);
  const provider = await prisma.provider.findUnique({ where: { id: body.providerId } });
  if (!provider) throw new HttpError(404, "المزوّد غير موجود");
  if (await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId: body.providerId, modelId: body.modelId } } })) {
    throw new HttpError(409, "هذا النموذج موجود مسبقًا لدى المزوّد");
  }
  const m = await prisma.aiModel.create({ data: { ...body, source: "MANUAL", inCatalog: true } });
  if (planKeys) await setModelPlans(m.id, planKeys);
  await log("model.create", { entityType: "model", entityId: m.id, details: { provider: provider.name, modelId: m.modelId, displayName: m.displayName, enabled: m.enabled } });
  await publish();
  return json({ model: m }, 201);
});
