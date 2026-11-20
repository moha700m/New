"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminPassword, defaultCurrency, isCurrency } from "@/lib/config";
import { ConflictError, pushHistory, updateDb, type Customer, type Database } from "@/lib/db";
import { formatMoney, parseAmountToMinor } from "@/lib/money";
import { hashSecret, rateLimit, safeEqualString, sleep } from "@/lib/security";
import { endAdminSession, requireAdmin, startAdminSession } from "@/lib/session";
import { field, parseCustomerNumber, parseName, parseNote, parsePin, type FormState } from "@/lib/validation";

class UserError extends Error {}

const fail = (error: string): FormState => ({ error, at: Date.now() });
const done = (message: string): FormState => ({ ok: true, message, at: Date.now() });

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    const message = await fn();
    revalidatePath("/admin", "layout");
    return done(message);
  } catch (e) {
    if (e instanceof UserError) return fail(e.message);
    if (e instanceof ConflictError) return fail("النظام مشغول حالياً، يرجى إعادة المحاولة.");
    console.error("[agentsii] admin action failed", e);
    return fail("حدث خطأ غير متوقع في الخادم. يرجى المحاولة مرة أخرى.");
  }
}

function findCustomer(db: Database, id: string): Customer {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw new UserError("العميل غير موجود.");
  return c;
}

/* ---------------- auth ---------------- */

export async function adminLogin(_prev: FormState, fd: FormData): Promise<FormState> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`admin-ip:${ip}`, 8, 15 * 60_000)) {
    return fail("محاولات كثيرة. يرجى الانتظار 15 دقيقة ثم المحاولة.");
  }
  const password = field(fd, "password");
  let expected: string;
  try {
    expected = adminPassword();
  } catch {
    return fail("لم يتم إعداد كلمة مرور الإدارة على الخادم بعد.");
  }
  if (!password || !safeEqualString(password, expected)) {
    await sleep(600);
    return fail("كلمة المرور غير صحيحة.");
  }
  await startAdminSession();
  redirect("/admin");
}

export async function adminLogout() {
  await endAdminSession();
  redirect("/admin/login");
}

/* ---------------- customers ---------------- */

export async function createCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const name = parseName(field(fd, "name"));
  const number = parseCustomerNumber(field(fd, "number"));
  const pin = parsePin(field(fd, "pin"));
  const currencyRaw = field(fd, "currency").toUpperCase() || defaultCurrency();
  const balanceRaw = field(fd, "balance") || "0";
  const balance = parseAmountToMinor(balanceRaw);
  const note = parseNote(field(fd, "note"));

  if (!name) return fail("اسم العميل مطلوب (من 2 إلى 80 حرفاً).");
  if (!number) return fail("رقم العميل يجب أن يتكون من أرقام فقط (حتى 20 رقماً).");
  if (!pin) return fail("رمز PIN يجب أن يتكون من 4 إلى 8 أرقام.");
  if (!isCurrency(currencyRaw)) return fail("العملة غير مدعومة.");
  if (balance === null) return fail("قيمة الرصيد غير صالحة.");

  const pinHash = await hashSecret(pin);
  return run(async () => {
    await updateDb((db) => {
      if (db.customers.some((c) => c.number === number)) {
        throw new UserError(`رقم العميل ${number} مستخدم مسبقاً.`);
      }
      const now = new Date().toISOString();
      const c: Customer = {
        id: randomUUID(),
        number,
        name,
        pinHash,
        currency: currencyRaw,
        balanceMinor: balance,
        status: "active",
        note,
        createdAt: now,
        updatedAt: now,
        balanceUpdatedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
        sessionVersion: 1,
        history: [],
      };
      pushHistory(c, { at: now, type: "create", amountMinor: balance, balanceAfterMinor: balance, note: "إنشاء الحساب" });
      db.customers.push(c);
    });
    return `تمت إضافة العميل ${name} برقم ${number}.`;
  });
}

export async function updateCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  const name = parseName(field(fd, "name"));
  const number = parseCustomerNumber(field(fd, "number"));
  const currency = field(fd, "currency").toUpperCase();
  const note = parseNote(field(fd, "note"));
  if (!name) return fail("اسم العميل مطلوب (من 2 إلى 80 حرفاً).");
  if (!number) return fail("رقم العميل يجب أن يتكون من أرقام فقط (حتى 20 رقماً).");
  if (!isCurrency(currency)) return fail("العملة غير مدعومة.");

  return run(async () => {
    await updateDb((db) => {
      const c = findCustomer(db, id);
      if (db.customers.some((x) => x.number === number && x.id !== id)) {
        throw new UserError(`رقم العميل ${number} مستخدم لعميل آخر.`);
      }
      if (c.number !== number) c.sessionVersion += 1;
      c.name = name;
      c.number = number;
      c.currency = currency;
      c.note = note;
      c.updatedAt = new Date().toISOString();
    });
    return "تم حفظ بيانات العميل.";
  });
}

export async function changeBalance(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  const mode = field(fd, "mode");
  const note = parseNote(field(fd, "note"));
  if (mode !== "set" && mode !== "credit" && mode !== "debit") return fail("نوع العملية غير صالح.");
  const amount = parseAmountToMinor(field(fd, "amount"), { allowNegative: mode === "set" });
  if (amount === null) return fail("أدخل مبلغاً صحيحاً (حتى منزلتين عشريتين).");
  if (mode !== "set" && amount === 0) return fail("المبلغ يجب أن يكون أكبر من صفر.");

  return run(async () => {
    const after = await updateDb((db) => {
      const c = findCustomer(db, id);
      const next = mode === "set" ? amount : mode === "credit" ? c.balanceMinor + amount : c.balanceMinor - amount;
      if (!Number.isSafeInteger(next) || Math.abs(next) > 10 ** 15) throw new UserError("القيمة الناتجة كبيرة جداً.");
      const now = new Date().toISOString();
      const delta = mode === "debit" ? -amount : amount;
      c.balanceMinor = next;
      c.balanceUpdatedAt = now;
      c.updatedAt = now;
      pushHistory(c, { at: now, type: mode, amountMinor: delta, balanceAfterMinor: next, note });
      return formatMoney(next, c.currency);
    });
    const label = mode === "set" ? "تم تعيين الرصيد" : mode === "credit" ? "تمت إضافة المبلغ" : "تم خصم المبلغ";
    return `${label}. الرصيد الحالي: ${after}`;
  });
}

export async function setCustomerStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  const status = field(fd, "status");
  if (status !== "active" && status !== "suspended") return fail("حالة غير صالحة.");
  return run(async () => {
    await updateDb((db) => {
      const c = findCustomer(db, id);
      c.status = status;
      if (status === "suspended") c.sessionVersion += 1;
      c.updatedAt = new Date().toISOString();
    });
    return status === "active" ? "تم تفعيل الحساب." : "تم إيقاف الحساب.";
  });
}

export async function resetPin(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  const pin = parsePin(field(fd, "pin"));
  if (!pin) return fail("رمز PIN يجب أن يتكون من 4 إلى 8 أرقام.");
  const pinHash = await hashSecret(pin);
  return run(async () => {
    await updateDb((db) => {
      const c = findCustomer(db, id);
      c.pinHash = pinHash;
      c.sessionVersion += 1;
      c.failedAttempts = 0;
      c.lockedUntil = null;
      c.updatedAt = new Date().toISOString();
    });
    return "تم تغيير رمز PIN وإلغاء قفل الحساب.";
  });
}

export async function unlockCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  return run(async () => {
    await updateDb((db) => {
      const c = findCustomer(db, id);
      c.failedAttempts = 0;
      c.lockedUntil = null;
    });
    return "تم إلغاء قفل تسجيل الدخول.";
  });
}

export async function deleteCustomer(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = field(fd, "id");
  const confirmNumber = parseCustomerNumber(field(fd, "confirm"));
  let removed = false;
  const state = await run(async () => {
    await updateDb((db) => {
      const c = findCustomer(db, id);
      if (confirmNumber !== c.number) throw new UserError("اكتب رقم العميل بشكل صحيح لتأكيد الحذف.");
      db.customers = db.customers.filter((x) => x.id !== id);
    });
    removed = true;
    return "تم حذف العميل نهائياً.";
  });
  if (removed) redirect("/admin?deleted=1");
  return state;
}
