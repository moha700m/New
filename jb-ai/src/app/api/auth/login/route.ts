import { z } from "zod";
import { createSession, ownerEmailMatches, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, handler, HttpError, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = handler(async (req: Request) => {
  const body = await parseBody(req, schema);
  rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000);
  rateLimit(`login:${body.email}`, 10, 15 * 60_000);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = user ? await verifyPassword(body.password, user.passwordHash) : await verifyPassword(body.password, "$2b$12$nkIVqjZKCNlLwOyhblGWe.0b77UwR4YbtZRjTWo5JeZpuqhxSayiG");
  if (!user || !ok) throw new HttpError(401, "Incorrect email or password");
  if (user.disabled) throw new HttpError(403, "This account has been disabled");
  if (ownerEmailMatches(user.email) && user.role !== "OWNER") await prisma.user.update({ where: { id: user.id }, data: { role: "OWNER" } });
  await createSession(user.id, req);
  return json({ ok: true });
});
