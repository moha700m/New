import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, clientIp, handler, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { canonicalEmail } from "@/lib/trial";

export const POST = handler(async (req: Request) => {
  await rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000).catch(() => {
    throw new HttpError(429, "طلبت استعادة كثير، جرّب بعد ساعة.", "forgot_rate_limited");
  });
  const { email } = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  // Exact address first, then the Gmail-normalised one (dots / +tags / case).
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.findFirst({ where: { emailCanonical: canonicalEmail(email) }, orderBy: { createdAt: "asc" } }));
  if (!user) throw new HttpError(404, "ما لقينا حساب بهالإيميل. سجّل حساب جديد من صفحة التسجيل.", "no_account");
  if (user.disabled) throw new HttpError(403, "هالحساب موقّف. كلّم الدعم على تلقرام @Justoio.", "account_disabled");
  try {
    await sendPasswordResetEmail(user);
  } catch (e) {
    console.error("[forgot] send failed", e);
    throw new HttpError(502, "ما قدرنا نرسل الإيميل الحين، جرّب بعد شوي.", "mail_failed");
  }
  console.log("[forgot] reset email sent", user.id);
  return json({ ok: true });
});
