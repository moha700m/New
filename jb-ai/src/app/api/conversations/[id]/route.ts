import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError, json, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function own(userId: string, id: string) {
  const c = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!c) throw new HttpError(404, "المحادثة غير موجودة");
  return c;
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const c = await own(user.id, id);
  const messages = await prisma.message.findMany({
    where: { conversationId: c.id },
    orderBy: { createdAt: "asc" },
    include: { attachments: { select: { id: true, filename: true, mimeType: true, size: true, kind: true } } },
  });
  return json({ conversation: { id: c.id, title: c.title, modelId: c.modelId }, messages });
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await own(user.id, id);
  const { title } = await parseBody(req, z.object({ title: z.string().trim().min(1).max(120) }));
  await prisma.conversation.update({ where: { id }, data: { title } });
  return json({ ok: true });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await own(user.id, id);
  await prisma.conversation.delete({ where: { id } });
  return json({ ok: true });
});
