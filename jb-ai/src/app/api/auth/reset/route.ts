import { z } from "zod";
import { consumeToken, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  const { token, password } = await parseBody(req, z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) }));
  const userId = await consumeToken(token, "PASSWORD_RESET");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId } }); // log out everywhere
  return json({ ok: true });
});
