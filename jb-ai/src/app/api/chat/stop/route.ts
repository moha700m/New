import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, json, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Asks a running server-side job to stop (it checks every few seconds). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { messageId } = await parseBody(req, z.object({ messageId: z.string().max(40) }));
    const r = await prisma.message.updateMany({ where: { id: messageId, status: "streaming", conversation: { userId: user.id } }, data: { stopRequested: true } });
    return json({ ok: r.count > 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
