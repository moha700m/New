import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { messages: { some: { content: { contains: q, mode: "insensitive" } } } }] } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true, modelId: true },
    take: 200,
  });
  return json({ conversations });
});

/** Deletes every conversation of the signed-in user (stops any run still going first). */
export const DELETE = handler(async () => {
  const user = await requireUser();
  await prisma.message.updateMany({ where: { status: "streaming", conversation: { userId: user.id } }, data: { stopRequested: true } });
  const { count } = await prisma.conversation.deleteMany({ where: { userId: user.id } });
  return json({ ok: true, deleted: count });
});
