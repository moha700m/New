import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { finishMcpOAuth, publicOrigin } from "@/lib/agent/oauth";
import { connectServer } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Redirect target of MCP authorization servers. */
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
  const err = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (err || !code || !state) return back(`error=${encodeURIComponent(u.searchParams.get("error_description") || err || "missing code")}`);
  try {
    const s = await finishMcpOAuth(state, code);
    let toolCount = 0;
    try {
      const c = await connectServer(s, undefined, 30_000);
      try {
        const tools = await c.listTools();
        toolCount = tools.length;
        await prisma.mcpServer.update({ where: { id: s.id }, data: { tools: tools as any, lastSyncAt: new Date(), lastError: null, enabled: true } });
      } finally {
        await c.close();
      }
    } catch (e) {
      await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: (e as Error).message.slice(0, 500) } });
    }
    await audit({ id: admin.id, email: admin.email }, "mcp.oauth_connected", { entityType: "mcp", entityId: s.id, details: { name: s.name, tools: toolCount } });
    return back(`connected=${encodeURIComponent(s.slug)}&tools=${toolCount}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 300))}`);
  }
}
