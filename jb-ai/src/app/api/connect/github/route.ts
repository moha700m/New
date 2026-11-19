import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { publicOrigin } from "@/lib/agent/oauth";
import { authorizeUrl, buildManifest, getGithubConnection } from "@/lib/agent/github";
import { adminForNavigation, connectLog, resultRedirect, safeBack } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Full-page «ربط GitHub»: GET /api/connect/github?back=/
 * - first time: serves a tiny page that POSTs the App manifest to github.com (top-level form, auto + button);
 * - app already created: redirects straight to GitHub's authorize page.
 * ?new=1 forces creating a fresh app.
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const u = new URL(req.url);
  const back = safeBack(u.searchParams.get("back"));
  const { user, redirect } = await adminForNavigation(req, origin);
  if (!user) return redirect!;
  try {
    const c = await getGithubConnection();
    if (c?.clientId && c.clientSecretEncrypted && u.searchParams.get("new") !== "1") {
      const url = await authorizeUrl(origin, back);
      await connectLog(req, { kind: "github", step: "start", target: c.appSlug, message: "authorize" });
      return NextResponse.redirect(url, 303);
    }
    const org = (u.searchParams.get("org") ?? "").replace(/[^A-Za-z0-9-]/g, "") || null;
    const m = await buildManifest(origin, org, back);
    await connectLog(req, { kind: "github", step: "start", target: m.manifest.name, message: "manifest" });
    await audit({ id: user.id, email: user.email }, "github.manifest_start", { entityType: "github", details: { name: m.manifest.name, org } });
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ربط GitHub</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f17;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.c{max-width:360px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 20px}
button{width:100%;padding:14px;border:0;border-radius:12px;background:#f8fafc;color:#0b0f17;font-size:16px;font-weight:700}</style></head>
<body><div class="c"><h1>ربط GitHub</h1><p>بننقلك لـ GitHub عشان ينشئ تطبيق خاص فيك بضغطة «Create GitHub App»، بعدها ثبّته على حسابك وترجع هنا تلقائيًا.</p>
<form id="f" method="post" action="${esc(m.action)}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(m.manifest))}"><button type="submit">متابعة إلى GitHub ←</button></form></div>
<script>setTimeout(function(){document.getElementById("f").submit()},300)</script></body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    await connectLog(req, { kind: "github", step: "error", ok: false, message: (e as Error).message });
    return resultRedirect(origin, { ok: false, name: "GitHub", message: (e as Error).message, back });
  }
}
