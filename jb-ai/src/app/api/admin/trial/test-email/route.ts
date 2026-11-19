import { adminRoute } from "@/lib/admin";
import { HttpError, json } from "@/lib/http";
import { mailerConfigured, sendMail } from "@/lib/mailer";

/** Sends one test email to the owner's own address to prove the SMTP setup works (no secrets are returned). */
export const POST = adminRoute(async ({ user, log }) => {
  if (!mailerConfigured()) throw new HttpError(400, "البريد (SMTP) غير مُعدّ");
  try {
    await sendMail(user.email, "اختبار البريد — محمد | التقني", "<p>هلا 👋 هذي رسالة تجربة: إرسال الإيميلات من موقعك شغّال ✓</p>", "هلا، هذي رسالة تجربة: إرسال الإيميلات من موقعك شغّال.");
  } catch (e) {
    throw new HttpError(502, "فشل الإرسال: " + String((e as Error).message).replace(/\/\/[^@]*@/g, "//***@").slice(0, 200));
  }
  await log("trial.test_email", {});
  return json({ ok: true, to: user.email });
});
