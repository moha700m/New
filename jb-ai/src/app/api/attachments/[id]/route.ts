import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError } from "@/lib/http";

export const GET = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const a = await prisma.attachment.findFirst({ where: { id, userId: user.id } });
  if (!a) throw new HttpError(404, "غير موجود");
  const inline = a.kind !== "text" && new URL(req.url).searchParams.get("download") !== "1";
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.kind !== "text" ? a.mimeType : "text/plain; charset=utf-8",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(a.filename)}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
