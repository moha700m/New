import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { consumeState, convertManifest } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";

export const dynamic = "force-dynamic";

/** GitHub redirects here after "Create GitHub App": save credentials, then send the user to install the app. */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.redirect(`${origin}/login?next=/admin/mcp`);
  }
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const st = await consumeState(u.searchParams.get("state"), "github_manifest");
  if (!code || !st) return NextResponse.redirect(`${origin}/admin/mcp?error=${encodeURIComponent("جلسة إنشاء تطبيق GitHub انتهت — جرّب «ربط GitHub» مرة ثانية")}`);
  try {
    const c = await convertManifest(code);
    await audit({ id: admin.id, email: admin.email }, "github.app_created", { entityType: "github", details: { appId: c.appId, slug: c.appSlug } });
    return NextResponse.redirect(`https://github.com/apps/${c.appSlug}/installations/new`);
  } catch (e) {
    return NextResponse.redirect(`${origin}/admin/mcp?error=${encodeURIComponent((e as Error).message.slice(0, 300))}`);
  }
}
