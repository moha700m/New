import { z } from "zod";
import { adminRoute, redactProvider } from "@/lib/admin";
import { encryptSecret, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { providerSchema } from "@/lib/admin-schemas";

const patchSchema = providerSchema.partial().extend({ clearApiKey: z.boolean().optional() });

export const PATCH = adminRoute<{ id: string }>(async ({ req, params, log, publish }) => {
  const body = await parseBody(req, patchSchema);
  const cur = await prisma.provider.findUnique({ where: { id: params.id } });
  if (!cur) throw new HttpError(404, "Provider not found");
  if (body.slug && body.slug !== cur.slug && (await prisma.provider.findUnique({ where: { slug: body.slug } }))) throw new HttpError(409, "Slug already in use");
  const { apiKey, clearApiKey, ...rest } = body;
  const data: Record<string, unknown> = { ...rest };
  if (rest.baseUrl) data.baseUrl = rest.baseUrl.replace(/\/+$/, "");
  if (apiKey) {
    data.apiKeyEncrypted = encryptSecret(apiKey);
    data.apiKeyLast4 = last4(apiKey);
    data.healthStatus = "UNKNOWN";
  } else if (clearApiKey) {
    data.apiKeyEncrypted = null;
    data.apiKeyLast4 = null;
  }
  const p = await prisma.provider.update({ where: { id: params.id }, data });
  const changed = Object.keys(rest).filter((k) => (rest as Record<string, unknown>)[k] !== undefined);
  await log(apiKey ? "provider.credentials_replaced" : "provider.update", {
    entityType: "provider",
    entityId: p.id,
    details: { name: p.name, changed, apiKeyReplaced: Boolean(apiKey), apiKeyCleared: Boolean(clearApiKey), enabled: p.enabled },
  });
  await publish();
  return json({ provider: redactProvider(p) });
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, log, publish }) => {
  const p = await prisma.provider.findUnique({ where: { id: params.id } });
  if (!p) throw new HttpError(404, "Provider not found");
  await prisma.$transaction(async (tx) => {
    const r = await tx.routingConfig.findUnique({ where: { id: "global" } });
    if (r) {
      const modelIds = (await tx.aiModel.findMany({ where: { providerId: p.id }, select: { id: true } })).map((m) => m.id);
      const clear = (v: string | null) => (v && modelIds.includes(v) ? null : v);
      await tx.routingConfig.update({
        where: { id: "global" },
        data: {
          defaultProviderId: r.defaultProviderId === p.id ? null : r.defaultProviderId,
          fallbackProviderId: r.fallbackProviderId === p.id ? null : r.fallbackProviderId,
          defaultTextModelId: clear(r.defaultTextModelId),
          defaultReasoningModelId: clear(r.defaultReasoningModelId),
          defaultCodingModelId: clear(r.defaultCodingModelId),
          defaultVisionModelId: clear(r.defaultVisionModelId),
          defaultImageModelId: clear(r.defaultImageModelId),
          fallbackModelId: clear(r.fallbackModelId),
        },
      });
    }
    await tx.provider.delete({ where: { id: p.id } });
  });
  await log("provider.delete", { entityType: "provider", entityId: p.id, details: { name: p.name } });
  await publish();
  return json({ ok: true });
});
