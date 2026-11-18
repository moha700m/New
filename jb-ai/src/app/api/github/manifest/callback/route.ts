import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { consumeState, convertManifest } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";
import { connectLog, resultRedirect } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";

/** GitHub redirects here after "Create GitHub App": save credentials (encrypted), then send the owner to install it. */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const st = await consumeState(u.searchParams.get("state"), "github_manifest");
  const back = ((st?.data as { back?: string } | null)?.back) ?? "/";
  await connectLog(req, { kind: "github", step: "callback", target: "manifest", ok: Boolean(code && st), message: !code ? "no code" : !st ? "state missing/expired" : "code received" });
  if (!code || !st) return resultRedirect(origin, { ok: false, name: "GitHub", message: "جلسة إنشاء تطبيق GitHub انتهت — اضغط «ربط GitHub» مرة ثانية", back });
  try {
    const c = await convertManifest(code);
    await connectLog(req, { kind: "github", step: "app_created", target: c.appSlug, message: `owner ${c.appOwner ?? "?"}` });
    const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true, email: true } });
    if (owner) await audit(owner, "github.app_created", { entityType: "github", details: { appId: c.appId, slug: c.appSlug } });
    return NextResponse.redirect(`https://github.com/apps/${c.appSlug}/installations/new`, 303);
  } catch (e) {
    await connectLog(req, { kind: "github", step: "error", target: "manifest", ok: false, message: (e as Error).message });
    return resultRedirect(origin, { ok: false, name: "GitHub", message: (e as Error).message, back });
  }
}
