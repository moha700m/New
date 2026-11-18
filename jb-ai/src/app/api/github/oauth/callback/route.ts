import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { consumeState, finishUserOAuth, USER_CALLBACK } from "@/lib/agent/github";
import { publicOrigin } from "@/lib/agent/oauth";
import { connectServer } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * User-to-server OAuth callback. Reached either from "Connect" (has our state) or right after installing
 * the app (request_oauth_on_install → GitHub adds code + installation_id + setup_action=install).
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/admin/mcp?${q}`);
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.redirect(`${origin}/login?next=/admin/mcp`);
  }
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const fromInstall = Boolean(u.searchParams.get("installation_id")) || u.searchParams.get("setup_action") === "install" || u.searchParams.get("setup_action") === "update";
  if (u.searchParams.get("error")) return back(`error=${encodeURIComponent(u.searchParams.get("error_description") || u.searchParams.get("error")!)}`);
  if (!code) return fromInstall ? back("github=installed") : back("error=missing%20code");
  if (state ? !(await consumeState(state, "github_user")) : !fromInstall) return back(`error=${encodeURIComponent("جلسة الربط انتهت — جرّب مرة ثانية")}`);
  try {
    const c = await finishUserOAuth(code, `${origin}${USER_CALLBACK}`);
    // load the GitHub MCP tool list (if the MCP server rejects the token, the agent falls back to REST tools)
    const s = await prisma.mcpServer.findUnique({ where: { slug: "github" } });
    let tools = 0;
    if (s) {
      try {
        const cl = await connectServer(s, undefined, 30_000);
        try {
          const list = await cl.listTools();
          tools = list.length;
          await prisma.mcpServer.update({ where: { id: s.id }, data: { tools: list as any, lastSyncAt: new Date(), lastError: null } });
        } finally {
          await cl.close();
        }
      } catch (e) {
        await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: `MCP: ${(e as Error).message.slice(0, 300)} — أدوات REST البديلة شغالة` } });
      }
    }
    await audit({ id: admin.id, email: admin.email }, "github.connected", { entityType: "github", details: { login: c.login, tools } });
    return back(`connected=github&tools=${tools}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 300))}`);
  }
}
