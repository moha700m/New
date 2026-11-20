"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readDb, updateDb } from "@/lib/db";
import { rateLimit, sleep, verifySecret } from "@/lib/security";
import { endCustomerSession, startCustomerSession } from "@/lib/session";
import { field, parseCustomerNumber, parsePin, type FormState } from "@/lib/validation";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const INVALID = "رقم العميل أو رمز PIN غير صحيح.";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function customerLogin(_prev: FormState, fd: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (!rateLimit(`cust-ip:${ip}`, 20, 15 * 60_000)) {
    return { error: "محاولات كثيرة. يرجى المحاولة لاحقاً.", at: Date.now() };
  }

  const number = parseCustomerNumber(field(fd, "number"));
  const pin = parsePin(field(fd, "pin"));
  if (!number || !pin) {
    await sleep(300);
    return { error: INVALID, at: Date.now() };
  }

  const db = await readDb();
  const customer = db.customers.find((c) => c.number === number);
  const pinOk = await verifySecret(pin, customer?.pinHash);

  if (!customer) {
    await sleep(200);
    return { error: INVALID, at: Date.now() };
  }

  if (customer.lockedUntil && new Date(customer.lockedUntil).getTime() > Date.now()) {
    return {
      error: `تم إيقاف تسجيل الدخول مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${LOCK_MINUTES} دقيقة.`,
      at: Date.now(),
    };
  }

  if (!pinOk) {
    await updateDb((d) => {
      const c = d.customers.find((x) => x.id === customer.id);
      if (!c) return;
      c.failedAttempts += 1;
      if (c.failedAttempts >= MAX_FAILED) {
        c.failedAttempts = 0;
        c.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      }
    });
    await sleep(200);
    return { error: INVALID, at: Date.now() };
  }

  if (customer.status !== "active") {
    return { error: "هذا الحساب موقوف حالياً. يرجى التواصل مع فريق Agentsii.", at: Date.now() };
  }

  if (customer.failedAttempts > 0 || customer.lockedUntil) {
    await updateDb((d) => {
      const c = d.customers.find((x) => x.id === customer.id);
      if (c) {
        c.failedAttempts = 0;
        c.lockedUntil = null;
      }
    });
  }

  await startCustomerSession(customer);
  redirect("/balance");
}

export async function customerLogout() {
  await endCustomerSession();
  redirect("/");
}
