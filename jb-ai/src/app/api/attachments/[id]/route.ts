import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError } from "@/lib/http";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const a = await prisma.attachment.findFirst({ where: { id, userId: user.id } });
  if (!a) throw new HttpError(404, "Not found");
  const inline = a.kind !== "text";
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": inline ? a.mimeType : "text/plain; charset=utf-8",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(a.filename)}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
