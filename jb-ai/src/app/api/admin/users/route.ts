import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const page = Math.max(1, Number(sp.get("page") || 1));
  const where = q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true, email: true, name: true, role: true, emailVerifiedAt: true, disabled: true, createdAt: true,
        subscription: { select: { status: true, interval: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, provider: true, plan: { select: { key: true, name: true } } } },
        _count: { select: { conversations: true, usage: true } },
      },
    }),
  ]);
  return json({ users, total, page, pageSize: 50 });
});
