import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "../db";
import { getCurrentUser, isAdminRole } from "../auth";

/** Records every step of a connect flow (also to the runtime log) so a failed «ربط» can be diagnosed. */
export async function connectLog(req: Request | null, e: { kind: "github" | "mcp"; step: string; target?: string | null; ok?: boolean; message?: string | null }) {
  const ua = req?.headers.get("user-agent")?.slice(0, 300) ?? null;
  console.log(`[connect] ${e.kind} ${e.step} ${e.target ?? ""} ok=${e.ok ?? true}${e.message ? ` msg=${e.message.slice(0, 300)}` : ""}`);
  await prisma.connectEvent
    .create({ data: { kind: e.kind, step: e.step, target: e.target ?? null, ok: e.ok ?? true, message: e.message?.slice(0, 1000) ?? null, userAgent: ua } })
    .catch(() => {});
}

/** Only same-site relative paths are allowed as "back" targets. */
export function safeBack(v: string | null | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v.slice(0, 300) : "/";
}

/** Final landing page of every connect flow (public page; shows only the result). */
export function resultRedirect(origin: string, r: { ok: boolean; name?: string | null; message?: string | null; back?: string | null; tools?: number }) {
  const q = new URLSearchParams({ ok: r.ok ? "1" : "0", back: safeBack(r.back) });
  if (r.name) q.set("name", r.name);
  if (r.message) q.set("msg", r.message.slice(0, 300));
  if (r.tools != null) q.set("tools", String(r.tools));
  return NextResponse.redirect(`${origin}/connected?${q}`, 303);
}

/** Admin check for top-level navigations (redirects to login instead of returning JSON). */
export async function adminForNavigation(req: Request, origin: string) {
  const u = await getCurrentUser();
  if (u && isAdminRole(u.role)) return { user: u, redirect: null };
  const url = new URL(req.url);
  return { user: null, redirect: NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(url.pathname + url.search)}`, 303) };
}
