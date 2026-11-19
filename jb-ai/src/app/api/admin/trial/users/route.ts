import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { hashPassword, ownerEmailMatches } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { canonicalEmail } from "@/lib/trial";

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().max(80).optional(),
  access: z.enum(["trial", "full"]).default("trial"),
});

/** Owner creates a trial (or full) account by hand — already verified, so it works without an email sender. */
export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, schema);
  const email = body.email.trim().toLowerCase();
  if (ownerEmailMatches(email)) throw new HttpError(400, "هذا إيميل المالك");
  const canon = canonicalEmail(email);
  const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { emailCanonical: canon }] }, select: { id: true } });
  if (exists) throw new HttpError(409, "فيه حساب بهالإيميل من قبل");
  const u = await prisma.user.create({
    data: { email, emailCanonical: canon, name: body.name || null, passwordHash: await hashPassword(body.password), access: body.access, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await log("trial.user_create", { entityType: "user", entityId: u.id, details: { email, access: body.access } });
  return json({ ok: true, id: u.id });
});
