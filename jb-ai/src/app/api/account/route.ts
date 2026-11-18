import { z } from "zod";
import { audit } from "@/lib/audit";
import { destroySession, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, HttpError, json, parseBody } from "@/lib/http";
import { cancelImmediately } from "@/lib/payments";

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(
    req,
    z.object({ name: z.string().trim().max(80).optional(), currentPassword: z.string().max(200).optional(), newPassword: z.string().min(8).max(200).optional() }),
  );
  const data: { name?: string | null; passwordHash?: string } = {};
  if (body.name !== undefined) data.name = body.name || null;
  if (body.newPassword) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!body.currentPassword || !(await verifyPassword(body.currentPassword, u.passwordHash))) throw new HttpError(400, "Current password is incorrect");
    data.passwordHash = await hashPassword(body.newPassword);
  }
  await prisma.user.update({ where: { id: user.id }, data });
  return json({ ok: true });
});

/** Permanently delete the account and all associated data (conversations, files, sessions). */
export const DELETE = handler(async (req: Request) => {
  const user = await requireUser();
  const { password } = await parseBody(req, z.object({ password: z.string().min(1).max(200) }));
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(password, u.passwordHash))) throw new HttpError(400, "Password is incorrect");
  if (u.role === "OWNER") throw new HttpError(400, "The owner account cannot be deleted from here.");
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (sub?.providerSubscriptionId && (sub.status === "ACTIVE" || sub.status === "TRIALING")) {
    await cancelImmediately(user.id).catch((e) => console.error("[account.delete] cancel failed", e));
  }
  await audit(null, "user.delete_self", { entityType: "user", entityId: user.id, details: { email: user.email } });
  await destroySession();
  await prisma.user.delete({ where: { id: user.id } });
  return json({ ok: true });
});
