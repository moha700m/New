import { requireUser, sendVerificationEmail } from "@/lib/auth";
import { handler, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const POST = handler(async () => {
  const user = await requireUser();
  if (user.emailVerifiedAt) return json({ ok: true, alreadyVerified: true });
  await rateLimit(`resend:${user.id}`, 3, 3600_000).catch(() => {
    throw new HttpError(429, "أرسلنا لك الرابط كذا مرة، استنى شوي وجرّب بعد ساعة.", "resend_limited");
  });
  const r = await sendVerificationEmail(user).catch((e) => {
    console.error(`[resend] failed user=${user.id}: ${(e as Error).message}`);
    return { sent: false };
  });
  if (!r.sent) throw new HttpError(502, "ما قدرنا نرسل الإيميل الحين، جرّب بعد شوي.", "mail_failed");
  return json({ ok: true });
});
