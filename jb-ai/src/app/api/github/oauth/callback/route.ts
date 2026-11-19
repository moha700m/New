import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { consumeState, finishUserOAuth, USER_CALLBACK } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";
import { connectLog, resultRedirect } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * User-to-server OAuth callback. Reached either from «ربط» (carries our DB state) or right after installing
 * the app (request_oauth_on_install → code + installation_id, no state: then only the app owner's account is accepted).
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const fromInstall = Boolean(u.searchParams.get("installation_id")) || ["install", "update"].includes(u.searchParams.get("setup_action") ?? "");
  const err = u.searchParams.get("error");
  const st = state ? await consumeState(state, "github_user") : null;
  const back = ((st?.data as { back?: string } | null)?.back) ?? "/";
  await connectLog(req, { kind: "github", step: "callback", target: fromInstall ? "install" : "oauth", ok: Boolean(code) && !err, message: err ? `${err}: ${u.searchParams.get("error_description") ?? ""}` : code ? "code received" : "no code" });
  if (err) return resultRedirect(origin, { ok: false, name: "GitHub", message: err === "access_denied" ? "ألغيت الربط من صفحة GitHub" : u.searchParams.get("error_description") || err, back });
  if (!code) return resultRedirect(origin, { ok: false, name: "GitHub", message: fromInstall ? "تم تثبيت التطبيق — اضغط «ربط GitHub» مرة ثانية لإكمال الربط" : "GitHub ما رجّع رمز الربط", back });
  if (state && !st) return resultRedirect(origin, { ok: false, name: "GitHub", message: "جلسة الربط انتهت — اضغط «ربط GitHub» مرة ثانية", back });
  if (!state && !fromInstall) return resultRedirect(origin, { ok: false, name: "GitHub", message: "طلب ربط غير معروف — ابدأ من زر «ربط GitHub»", back });
  try {
    const c = await finishUserOAuth(code, `${origin}${USER_CALLBACK}`, { requireAppOwner: !st });
    await connectLog(req, { kind: "github", step: "done", target: c.login });
    const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true, email: true } });
    if (owner) await audit(owner, "github.connected", { entityType: "github", details: { login: c.login } });
    return resultRedirect(origin, { ok: true, name: `GitHub (${c.login ?? ""})`, back });
  } catch (e) {
    await connectLog(req, { kind: "github", step: "error", ok: false, message: (e as Error).message });
    return resultRedirect(origin, { ok: false, name: "GitHub", message: (e as Error).message, back });
  }
}
