import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminPassword, sessionSecret } from "./config";
import { hmac, safeEqualString } from "./security";
import { readDb, type Customer } from "./db";

const ADMIN_COOKIE = "agx_admin";
const CUSTOMER_COOKIE = "agx_customer";
const ADMIN_TTL_S = 8 * 60 * 60;
const CUSTOMER_TTL_S = 15 * 60;

type AdminPayload = { r: "admin"; exp: number; k: string };
type CustomerPayload = { r: "customer"; exp: number; id: string; v: number };

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(sessionSecret(), body)}`;
}

function unsign<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqualString(sig, hmac(sessionSecret(), body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Fingerprint of the admin password: changing ADMIN_PASSWORD ends every admin session. */
function adminKey(): string {
  return hmac(sessionSecret(), `admin:${adminPassword()}`).slice(0, 16);
}

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

/* ---------------- admin ---------------- */

export async function startAdminSession() {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TTL_S;
  (await cookies()).set(ADMIN_COOKIE, sign({ r: "admin", exp, k: adminKey() } satisfies AdminPayload), {
    ...cookieBase,
    maxAge: ADMIN_TTL_S,
  });
}

export async function isAdmin(): Promise<boolean> {
  const p = unsign<AdminPayload>((await cookies()).get(ADMIN_COOKIE)?.value);
  return !!p && p.r === "admin" && safeEqualString(p.k, adminKey());
}

/** Call at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

/* ---------------- customer ---------------- */

export async function startCustomerSession(c: Customer) {
  const exp = Math.floor(Date.now() / 1000) + CUSTOMER_TTL_S;
  (await cookies()).set(
    CUSTOMER_COOKIE,
    sign({ r: "customer", exp, id: c.id, v: c.sessionVersion } satisfies CustomerPayload),
    { ...cookieBase, maxAge: CUSTOMER_TTL_S },
  );
}

/** Returns the signed-in, active customer, or null. */
export async function currentCustomer(): Promise<Customer | null> {
  const p = unsign<CustomerPayload>((await cookies()).get(CUSTOMER_COOKIE)?.value);
  if (!p || p.r !== "customer") return null;
  const db = await readDb();
  const c = db.customers.find((x) => x.id === p.id);
  if (!c || c.sessionVersion !== p.v || c.status !== "active") return null;
  return c;
}

export async function endCustomerSession() {
  (await cookies()).delete(CUSTOMER_COOKIE);
}
