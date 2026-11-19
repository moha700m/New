import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { isOwnerAccount } from "@/lib/access";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";

const schema = z.object({ action: z.enum(["full", "trial", "reset", "verify", "disable", "enable", "delete"]) });

/** Owner actions on a trial account: upgrade to full (unlimited), back to trial, reset messages, verify, disable/enable, delete. */
export const POST = adminRoute<{ id: string }>(async ({ req, params, log }) => {
  const { action } = await parseBody(req, schema);
  const u = await prisma.user.findUnique({ where: { id: params.id } });
  if (!u) throw new HttpError(404, "المستخدم غير موجود");
  if (isOwnerAccount(u) || (u.access !== "trial" && u.access !== "full")) throw new HttpError(400, "هذا الإجراء لحسابات التجربة فقط");
  if (action === "delete") {
    await prisma.user.delete({ where: { id: u.id } });
  } else {
    const data =
      action === "full" ? { access: "full" }
      : action === "trial" ? { access: "trial" }
      : action === "reset" ? { trialUsed: 0 }
      : action === "verify" ? { emailVerifiedAt: u.emailVerifiedAt ?? new Date() }
      : action === "disable" ? { disabled: true }
      : { disabled: false };
    await prisma.user.update({ where: { id: u.id }, data });
    if (action === "disable") await prisma.session.deleteMany({ where: { userId: u.id } });
  }
  await log(`trial.user_${action}`, { entityType: "user", entityId: u.id, details: { email: u.email } });
  return json({ ok: true });
});
