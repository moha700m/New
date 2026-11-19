import { z } from "zod";
import { consumeToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  const { token } = await parseBody(req, z.object({ token: z.string().min(10).max(200) }));
  const userId = await consumeToken(token, "EMAIL_VERIFY");
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  return json({ ok: true });
});
