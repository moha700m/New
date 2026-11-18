import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { publicOrigin } from "@/lib/agent/oauth";
import { beginConnect, resolveServer } from "@/lib/agent/connect-flow";
import { adminForNavigation, connectLog, resultRedirect, safeBack } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Full-page «ربط» for an MCP connector: GET /api/connect/mcp?preset=notion&back=/
 * (a plain link — no fetch-then-redirect, so it works the same on mobile Safari, in-app browsers and desktop).
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const u = new URL(req.url);
  const back = safeBack(u.searchParams.get("back"));
  const { user, redirect } = await adminForNavigation(req, origin);
  if (!user) return redirect!;
  const preset = u.searchParams.get("preset");
  const serverId = u.searchParams.get("id");
  let name: string | null = preset;
  try {
    const server = await resolveServer({ preset, serverId });
    name = server.name;
    const r = await beginConnect(server, origin, back);
    if (r.connected) {
      await connectLog(req, { kind: "mcp", step: "done", target: server.slug, message: `no auth, ${r.toolCount} tools` });
      await audit({ id: user.id, email: user.email }, "mcp.connect", { entityType: "mcp", entityId: server.id, details: { name: server.name, auth: "none", tools: r.toolCount } });
      return resultRedirect(origin, { ok: true, name: server.name, back, tools: r.toolCount });
    }
    await connectLog(req, { kind: "mcp", step: "start", target: server.slug, message: new URL(r.authorizeUrl).origin });
    await audit({ id: user.id, email: user.email }, "mcp.oauth_start", { entityType: "mcp", entityId: server.id, details: { name: server.name, issuer: new URL(r.authorizeUrl).origin } });
    return NextResponse.redirect(r.authorizeUrl, 303);
  } catch (e) {
    await connectLog(req, { kind: "mcp", step: "error", target: name, ok: false, message: (e as Error).message });
    return resultRedirect(origin, { ok: false, name, message: (e as Error).message, back });
  }
}
