import { z } from "zod";
import { audit } from "@/lib/audit";
import { createSession, hashPassword, ownerEmailMatches, sendVerificationEmail } from "@/lib/auth";
import { isPrivateMode } from "@/lib/access";
import { prisma } from "@/lib/db";
import { clientIp, handler, HttpError, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "كلمة المرور يجب أن تكون ٨ أحرف على الأقل").max(200),
  name: z.string().trim().max(80).optional(),
});

export const POST = handler(async (req: Request) => {
  if (isPrivateMode()) throw new HttpError(403, "التسجيل مغلق — الموقع خاص حاليًا.", "registration_closed");
  await rateLimit(`register:${clientIp(req)}`, 10, 3600_000);
  const body = await parseBody(req, schema);
  const settings = await getSettings();
  const isOwner = ownerEmailMatches(body.email);
  if (!settings.registrationOpen && !isOwner) throw new HttpError(403, "التسجيل مغلق حاليًا");
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new HttpError(409, "يوجد حساب مسجّل بهذا البريد الإلكتروني");
  const user = await prisma.user.create({
    data: { email: body.email, passwordHash: await hashPassword(body.password), name: body.name || null, role: isOwner ? "OWNER" : "USER" },
  });
  const mail = await sendVerificationEmail(user).catch((e) => ({ sent: false, reason: (e as Error).message }));
  await createSession(user.id, req);
  await audit({ id: user.id, email: user.email }, "user.register", { entityType: "user", entityId: user.id, ip: clientIp(req) });
  return json({ ok: true, verificationEmailSent: mail.sent }, 201);
});
