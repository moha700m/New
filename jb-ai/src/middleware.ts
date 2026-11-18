import { NextResponse, type NextRequest } from "next/server";

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
    if (!origin || !host) return NextResponse.json({ error: "Missing origin" }, { status: 403 });
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Bad origin" }, { status: 403 });
    }
    if (originHost !== host) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  if (pathname.startsWith("/admin") && !req.cookies.get("jb_session")) {
    return NextResponse.redirect(new URL("/login?next=/admin", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*", "/admin/:path*"] };
