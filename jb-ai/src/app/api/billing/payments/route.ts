import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = await requireUser();
  const payments = await prisma.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return json({ payments });
});
