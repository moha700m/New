import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { Role, TokenType, User } from "@prisma/client";
import { isOwnerAccount, isPrivateMode, ownerEmails } from "./access";
import { prisma } from "./db";
import { randomToken, sha256 } from "./crypto";
import { HttpError } from "./http";
import { appUrl, mailerConfigured, sendMail } from "./mailer";
import { getSettings } from "./settings";
import { getTrialSettings } from "./trial";

/** While the site is private: trial accounts get in while the trial is on, manually upgraded ("full") accounts always. */
export async function privateModeAllows(u: { access?: string | null }) {
  if (u.access === "full") return true;
  if (u.access === "trial") return (await getTrialSettings()).enabled;
  return false;
}

export const SESSION_COOKIE = "jb_session";
const SESSION_DAYS = 30;

export type SafeUser = Pick<User, "id" | "email" | "name" | "role" | "emailVerifiedAt" | "createdAt" | "access">;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function isAdminRole(role: Role) {
  return role === "ADMIN" || role === "OWNER";
}

export async function createSession(userId: string, req?: Request) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: req?.headers.get("user-agent")?.slice(0, 300),
      ip: req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true, createdAt: true, disabled: true, access: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.disabled) return null;
  if (isPrivateMode() && !isOwnerAccount(session.user) && !(await privateModeAllows(session.user))) return null;
  if (Date.now() - session.lastUsedAt.getTime() > 3600_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  const { disabled: _d, ...u } = session.user;
  return u;
}

export async function requireUser(): Promise<SafeUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "يجب تسجيل الدخول", "unauthenticated");
  return u;
}

export async function requireAdmin(): Promise<SafeUser> {
  const u = await requireUser();
  if (!isAdminRole(u.role)) throw new HttpError(403, "هذه الصفحة للمسؤولين فقط", "forbidden");
  return u;
}

export async function requireOwner(): Promise<SafeUser> {
  const u = await requireUser();
  if (u.role !== "OWNER") throw new HttpError(403, "هذا الإجراء للمالك فقط", "forbidden");
  return u;
}

/** Whether the user must verify their email before chatting. */
export async function needsVerification(u: SafeUser) {
  if (u.emailVerifiedAt || isOwnerAccount(u)) return false;
  if (u.access === "trial") return (await getTrialSettings()).requireVerification;
  const s = await getSettings();
  return s.requireEmailVerification && mailerConfigured();
}

export async function issueToken(userId: string, type: TokenType, ttlMs: number) {
  await prisma.verificationToken.deleteMany({ where: { userId, type, usedAt: null } });
  const token = randomToken(32);
  await prisma.verificationToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

export async function consumeToken(token: string, type: TokenType) {
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, "الرابط ما يشتغل أو انتهت مدته.", "invalid_token");
  }
  await prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

export async function sendVerificationEmail(user: { id: string; email: string }) {
  const token = await issueToken(user.id, "EMAIL_VERIFY", 48 * 3600_000);
  const s = await getSettings();
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  return sendMail(
    user.email,
    `أكّد إيميلك في ${s.siteName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>هلا والله في ${s.siteName}! 👋</p><p><a href="${link}">اضغط هنا وأكّد إيميلك</a> وتقدر تبدأ تجربتك المجانية على طول.</p><p>الرابط شغال لمدة ٤٨ ساعة.</p></div>`,
    `هلا والله في ${s.siteName}! أكّد إيميلك من هالرابط وابدأ تجربتك: ${link}`,
  );
}

export async function sendPasswordResetEmail(user: { id: string; email: string }) {
  const token = await issueToken(user.id, "PASSWORD_RESET", 3600_000);
  const s = await getSettings();
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  return sendMail(
    user.email,
    `غيّر كلمة السر في ${s.siteName}`,
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>هلا، وصلنا طلب تغيير كلمة السر لحسابك.</p><p><a href="${link}">اضغط هنا واختر كلمة سر جديدة</a></p><p>الرابط يشتغل ساعة وحدة. إذا ما طلبت هالشي، تجاهل الرسالة.</p></div>`,
    `غيّر كلمة السر من هالرابط (يشتغل ساعة): ${link}`,
  );
}

export function ownerEmailMatches(email: string) {
  return ownerEmails().includes(email.toLowerCase());
}
