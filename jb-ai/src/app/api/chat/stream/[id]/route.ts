import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { STALE_MS } from "@/lib/chat-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Resume a server-side run: streams the stored events after `?after=<seq>` and keeps following new ones until the
 * run finishes (or ~50 s pass; the client then simply reconnects). Works after a reload, a locked phone or a new tab.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let after = 0;
  let messageId: string;
  try {
    const user = await requireUser();
    messageId = (await ctx.params).id;
    after = Math.max(0, Number(new URL(req.url).searchParams.get("after") || 0) || 0);
    const msg = await prisma.message.findFirst({ where: { id: messageId, conversation: { userId: user.id } }, select: { id: true } });
    if (!msg) throw new HttpError(404, "الرسالة غير موجودة");
  } catch (e) {
    return errorResponse(e);
  }
  const encoder = new TextEncoder();
  const started = Date.now();
  let closed = false;
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        while (!closed && Date.now() - started < 50_000) {
          const rows = await prisma.chatEvent.findMany({ where: { messageId, seq: { gt: after } }, orderBy: { seq: "asc" }, take: 500 });
          for (const r of rows) {
            send({ ...(r.data as object), seq: r.seq });
            after = r.seq;
          }
          if (rows.length === 500) continue;
          const m = await prisma.message.findUnique({ where: { id: messageId }, select: { status: true, content: true, error: true, costUsd: true, modelName: true } });
          if (!m) break;
          if (m.status !== "streaming") {
            // finished: make sure the client gets a terminal event even if the event log was cleaned up
            const ended = rows.some((r) => ["done", "error"].includes(String((r.data as { type?: string }).type)));
            if (!ended && !rows.length) send({ type: "final", status: m.status, content: m.content, error: m.error, costUsd: m.costUsd, model: { name: m.modelName } });
            break;
          }
          const last = await prisma.chatEvent.findFirst({ where: { messageId }, orderBy: { seq: "desc" }, select: { createdAt: true } });
          if (Date.now() - (last?.createdAt.getTime() ?? 0) > STALE_MS) {
            // the function running it was killed (timeout / crash): close it out instead of spinning forever
            const err = "انقطع تشغيل الطلب في الخادم قبل ما يكمل. قل «كمل» وأكمل من حيث وقف.";
            await prisma.message.updateMany({ where: { id: messageId, status: "streaming" }, data: { status: "error", error: err } });
            send({ type: "error", error: err });
            break;
          }
          send({ type: "keepalive" });
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch (e) {
        console.error("[chat-stream] resume failed", (e as Error).message);
      } finally {
        try {
          ctrl.close();
        } catch {}
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
