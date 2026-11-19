import { z } from "zod";
import { audit } from "@/lib/audit";
import { createSession, hashPassword, ownerEmailMatches, sendVerificationEmail } from "@/lib/auth";
import { isPrivateMode } from "@/lib/access";
import { prisma } from "@/lib/db";
import { clientIp, handler, HttpError, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { canonicalEmail, getTrialSettings, isDisposableEmail, trialRegistrationOpen } from "@/lib/trial";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "كلمة المرور يجب أن تكون ٨ أحرف على الأقل").max(200),
  name: z.string().trim().max(80).optional(),
});

export const POST = handler(async (req: Request) => {
  const ip = clientIp(req);
  await rateLimit(`register:${ip}`, 10, 3600_000);
  const body = await parseBody(req, schema);
  const isOwner = ownerEmailMatches(body.email);
  let trial = false;
  if (isPrivateMode()) {
    const taken = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (isOwner && !taken) {
      // owner bootstrap
    } else {
      // Private site: the only public sign-up is the free trial
      const t = await getTrialSettings();
      if (!t.enabled) throw new HttpError(403, "التسجيل مغلق — الموقع خاص حاليًا.", "registration_closed");
      if (!trialRegistrationOpen(t)) throw new HttpError(503, "التسجيل في التجربة المجانية يفتح قريب، جرّب بعد شوي.", "trial_signup_unavailable");
      trial = true;
    }
  } else {
    const settings = await getSettings();
    if (!settings.registrationOpen && !isOwner) throw new HttpError(403, "التسجيل مغلق حاليًا");
  }

  const canonical = canonicalEmail(body.email);
  if (trial) {
    if (isDisposableEmail(body.email)) throw new HttpError(400, "حط إيميلك الحقيقي، الإيميلات المؤقتة ما تمشي.", "disposable_email");
    const dup = await prisma.user.findFirst({ where: { OR: [{ email: body.email }, { emailCanonical: canonical }] }, select: { id: true } });
    if (dup) throw new HttpError(409, "عندك حساب بهالإيميل من قبل، سجّل دخولك.", "account_exists");
    await rateLimit(`trial-register:${ip}`, 2, 86_400_000).catch(() => {
      throw new HttpError(429, "انسوت حسابات كثير من نفس الشبكة اليوم، جرّب بكرة.", "trial_ip_limit");
    });
  }
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: body.email }, { emailCanonical: canonical }] } });
  if (exists) throw new HttpError(409, "عندك حساب بهالإيميل من قبل، سجّل دخولك.");
  const user = await prisma.user.create({
    data: {
      email: body.email,
      emailCanonical: canonical,
      passwordHash: await hashPassword(body.password),
      name: body.name || null,
      role: isOwner ? "OWNER" : "USER",
      access: trial ? "trial" : null,
      signupIp: ip?.slice(0, 64) ?? null,
    },
  });
  const mail = await sendVerificationEmail(user).catch((e) => ({ sent: false, reason: (e as Error).message }));
  if (!mail.sent) console.error(`[register] verification email not sent user=${user.id}: ${mail.reason ?? ""}`);
  await createSession(user.id, req);
  await audit({ id: user.id, email: user.email }, trial ? "user.register_trial" : "user.register", { entityType: "user", entityId: user.id, ip });
  return json({ ok: true, trial, verificationEmailSent: mail.sent }, 201);
});
