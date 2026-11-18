import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, handler, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const POST = handler(async (req: Request) => {
  rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000);
  const { email } = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.disabled) await sendPasswordResetEmail(user).catch((e) => console.error("[forgot]", e));
  // Same response either way to avoid account enumeration.
  return json({ ok: true });
});
