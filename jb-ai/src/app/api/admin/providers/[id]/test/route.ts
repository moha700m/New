import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { getAdapter } from "@/lib/providers";

export const POST = adminRoute<{ id: string }>(async ({ params, log }) => {
  const p = await prisma.provider.findUnique({ where: { id: params.id } });
  if (!p) throw new HttpError(404, "Provider not found");
  const result = await getAdapter(p).testConnection();
  await prisma.provider.update({
    where: { id: p.id },
    data: { healthStatus: result.ok ? "HEALTHY" : "DOWN", healthLatencyMs: result.latencyMs, lastHealthAt: new Date(), lastHealthError: result.ok ? null : result.detail.slice(0, 500) },
  });
  await log("provider.test", { entityType: "provider", entityId: p.id, details: { ok: result.ok, detail: result.detail.slice(0, 300) } });
  return json({ result });
});
