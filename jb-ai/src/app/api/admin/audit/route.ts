import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const action = sp.get("action") || undefined;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const where = action ? { action: { startsWith: action } } : {};
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100 }),
  ]);
  return json({ logs, total, page });
});
