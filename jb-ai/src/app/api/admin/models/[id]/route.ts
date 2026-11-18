import { adminRoute } from "@/lib/admin";
import { modelPatchSchema } from "@/lib/admin-schemas";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { setModelPlans } from "@/lib/model-admin";

export const PATCH = adminRoute<{ id: string }>(async ({ req, params, log, publish }) => {
  const { planKeys, ...body } = await parseBody(req, modelPatchSchema);
  const cur = await prisma.aiModel.findUnique({ where: { id: params.id } });
  if (!cur) throw new HttpError(404, "Model not found");
  if (body.modelId && body.modelId !== cur.modelId) {
    const dup = await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId: cur.providerId, modelId: body.modelId } } });
    if (dup) throw new HttpError(409, "Another entry already uses this model ID");
  }
  const m = await prisma.aiModel.update({ where: { id: params.id }, data: body });
  if (planKeys) await setModelPlans(m.id, planKeys);
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined && (cur as Record<string, unknown>)[k] !== v) changes[k] = { from: (cur as Record<string, unknown>)[k], to: v };
  if (planKeys) changes.planKeys = planKeys;
  await log("model.update", { entityType: "model", entityId: m.id, details: { modelId: m.modelId, changes } });
  await publish();
  return json({ model: m });
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, log, publish }) => {
  const m = await prisma.aiModel.findUnique({ where: { id: params.id } });
  if (!m) throw new HttpError(404, "Model not found");
  const r = await prisma.routingConfig.findUnique({ where: { id: "global" } });
  if (r) {
    const fields = ["defaultTextModelId", "defaultReasoningModelId", "defaultCodingModelId", "defaultVisionModelId", "defaultImageModelId", "fallbackModelId"] as const;
    const data: Record<string, null> = {};
    for (const f of fields) if (r[f] === m.id) data[f] = null;
    if (Object.keys(data).length) await prisma.routingConfig.update({ where: { id: "global" }, data });
  }
  await prisma.aiModel.delete({ where: { id: m.id } });
  await log("model.delete", { entityType: "model", entityId: m.id, details: { modelId: m.modelId, displayName: m.displayName } });
  await publish();
  return json({ ok: true });
});
