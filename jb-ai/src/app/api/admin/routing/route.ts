import { adminRoute } from "@/lib/admin";
import { routingSchema } from "@/lib/admin-schemas";
import { prisma } from "@/lib/db";
import { getRouting } from "@/lib/engine";
import { HttpError, json, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => json({ routing: await getRouting() }));

export const PUT = adminRoute(async ({ req, log, publish }) => {
  const body = await parseBody(req, routingSchema);
  const modelFields = ["defaultTextModelId", "defaultReasoningModelId", "defaultCodingModelId", "defaultVisionModelId", "defaultImageModelId", "fallbackModelId"] as const;
  const toEnable: string[] = [];
  for (const f of modelFields) {
    const id = body[f];
    if (!id) continue;
    const m = await prisma.aiModel.findUnique({ where: { id } });
    if (!m) throw new HttpError(400, `${f}: النموذج غير موجود`);
    if (f === "defaultImageModelId" ? !m.supportsImageGeneration : !m.supportsText) throw new HttpError(400, `${f}: النموذج ${m.displayName} لا يدعم هذا الدور`);
    if (!m.enabled) toEnable.push(m.id);
  }
  for (const f of ["defaultProviderId", "fallbackProviderId"] as const) {
    if (body[f] && !(await prisma.provider.findUnique({ where: { id: body[f]! } }))) throw new HttpError(400, `${f}: المزوّد غير موجود`);
  }
  const before = await getRouting();
  if (toEnable.length) await prisma.aiModel.updateMany({ where: { id: { in: toEnable } }, data: { enabled: true } });
  const routing = await prisma.routingConfig.update({ where: { id: "global" }, data: body });
  await log("routing.update", { entityType: "routing", entityId: "global", details: { before, after: routing, autoEnabledModels: toEnable } });
  await publish();
  return json({ routing });
});
