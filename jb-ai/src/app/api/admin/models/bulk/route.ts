import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json, parseBody } from "@/lib/http";

const schema = z.object({
  ids: z.array(z.string().max(40)).min(1).max(1000),
  action: z.enum(["enable", "disable", "delete", "reorder"]),
  order: z.array(z.object({ id: z.string().max(40), sortOrder: z.number().int().min(0).max(100000) })).optional(),
});

export const POST = adminRoute(async ({ req, log, publish }) => {
  const body = await parseBody(req, schema);
  let count = 0;
  if (body.action === "enable" || body.action === "disable") {
    count = (await prisma.aiModel.updateMany({ where: { id: { in: body.ids } }, data: { enabled: body.action === "enable" } })).count;
  } else if (body.action === "delete") {
    count = (await prisma.aiModel.deleteMany({ where: { id: { in: body.ids } } })).count;
  } else if (body.order) {
    await prisma.$transaction(body.order.map((o) => prisma.aiModel.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } })));
    count = body.order.length;
  }
  await log(`model.bulk_${body.action}`, { entityType: "model", details: { count, ids: body.ids.slice(0, 50) } });
  await publish();
  return json({ ok: true, count });
});
