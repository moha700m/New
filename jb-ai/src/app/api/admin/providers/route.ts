import { adminRoute, redactProvider } from "@/lib/admin";
import { encryptSecret, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { providerSchema } from "@/lib/admin-schemas";
import { PROVIDER_TYPES } from "@/lib/providers";

export const dynamic = "force-dynamic";


export const GET = adminRoute(async () => {
  const providers = await prisma.provider.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }], include: { _count: { select: { models: true } } } });
  const enabledCounts = await prisma.aiModel.groupBy({ by: ["providerId"], where: { enabled: true }, _count: true });
  return json({
    providers: providers.map((p) => ({ ...redactProvider(p), modelCount: p._count.models, enabledModelCount: enabledCounts.find((c) => c.providerId === p.id)?._count ?? 0 })),
    types: PROVIDER_TYPES,
  });
});

export const POST = adminRoute(async ({ req, log, publish }) => {
  const body = await parseBody(req, providerSchema);
  if (await prisma.provider.findUnique({ where: { slug: body.slug } })) throw new HttpError(409, "يوجد مزوّد بنفس المعرّف");
  const def = PROVIDER_TYPES.find((t) => t.type === body.type)!;
  const p = await prisma.provider.create({
    data: {
      name: body.name,
      slug: body.slug,
      type: body.type,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
      authHeader: body.authHeader ?? def.authHeader,
      authScheme: body.authScheme ?? def.authScheme,
      extraHeaders: body.extraHeaders,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 100,
      timeoutMs: body.timeoutMs ?? 120000,
      ...(body.apiKey ? { apiKeyEncrypted: encryptSecret(body.apiKey), apiKeyLast4: last4(body.apiKey) } : {}),
    },
  });
  await log("provider.create", { entityType: "provider", entityId: p.id, details: { name: p.name, type: p.type, baseUrl: p.baseUrl, apiKeySet: Boolean(body.apiKey) } });
  await publish();
  return json({ provider: redactProvider(p) }, 201);
});
