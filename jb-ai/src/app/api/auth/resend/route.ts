import { requireUser, sendVerificationEmail } from "@/lib/auth";
import { handler, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export const POST = handler(async () => {
  const user = await requireUser();
  if (user.emailVerifiedAt) return json({ ok: true, alreadyVerified: true });
  rateLimit(`resend:${user.id}`, 3, 3600_000);
  const r = await sendVerificationEmail(user);
  if (!r.sent) throw new HttpError(503, "Email delivery is not configured on this server.");
  return json({ ok: true });
});
