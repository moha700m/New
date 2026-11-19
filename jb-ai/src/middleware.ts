import { NextResponse, type NextRequest } from "next/server";
import { isPrivateMode } from "./lib/access";

/** Reachable without a session while the site is private (everything else needs the owner to be signed in). */
const PUBLIC_PAGES = ["/register", "/login", "/forgot-password", "/reset-password", "/verify-email", "/connected", "/s/"];
const PUBLIC_API = ["/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/forgot", "/api/auth/reset", "/api/auth/verify", "/api/health", "/api/config", "/api/webhooks/",
  // OAuth/GitHub callbacks are authenticated by their single-use DB state, not the cookie (the provider page may open in another browser)
  "/api/oauth/", "/api/github/"];
const isPublic = (path: string, list: string[]) => list.some((p) => path === p || (p.endsWith("/") ? path.startsWith(p) : path.startsWith(`${p}/`)));

/**
 * CSRF defence: state-changing API requests must come from our own origin.
 * (Session cookie is SameSite=Lax + HttpOnly; webhooks are exempt and verified by signature.)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method) && !pathname.startsWith("/api/webhooks/")) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host) return NextResponse.json({ error: "مصدر الطلب مفقود" }, { status: 403 });
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "مصدر الطلب غير صالح" }, { status: 403 });
    }
    if (originHost !== host) return NextResponse.json({ error: "تم حظر طلب من موقع آخر" }, { status: 403 });
  }
  const hasSession = Boolean(req.cookies.get("jb_session"));
  if (isPrivateMode()) {
    if (pathname.startsWith("/api/connect/") && !hasSession) {
      // full-page connect links: send to login, then come back
      return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + req.nextUrl.search)}`, req.url));
    }
    if (pathname.startsWith("/api/")) {
      if (!hasSession && !isPublic(pathname, PUBLIC_API)) return NextResponse.json({ error: "الموقع خاص — يجب تسجيل الدخول", code: "unauthenticated" }, { status: 401 });
    } else if (!hasSession && !isPublic(pathname, PUBLIC_PAGES)) {
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
      return NextResponse.redirect(new URL(`/login${next}`, req.url));
    }
  }
  if (pathname.startsWith("/admin") && !hasSession) {
    return NextResponse.redirect(new URL("/login?next=/admin", req.url));
  }
  return NextResponse.next();
}

// Everything except Next.js internals and static files (paths with a file extension).
export const config = { matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"] };
