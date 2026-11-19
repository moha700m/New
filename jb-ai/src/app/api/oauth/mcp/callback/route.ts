import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { finishMcpOAuth, peekMcpState, publicOrigin } from "@/lib/agent/oauth";
import { syncTools } from "@/lib/agent/connect-flow";
import { connectLog, resultRedirect } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Redirect target of MCP authorization servers. Authenticated by the single-use state stored in the DB
 * (created by the signed-in owner), so it works even if the provider's page opened in another browser/app.
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const u = new URL(req.url);
  const err = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const peek = await peekMcpState(state);
  await connectLog(req, { kind: "mcp", step: "callback", target: peek?.name ?? null, ok: Boolean(code && !err), message: err ? `${err}: ${u.searchParams.get("error_description") ?? ""}` : code ? "code received" : "no code" });
  if (err || !code || !state) {
    const msg = err === "access_denied" ? "ألغيت الربط من صفحة المزوّد" : u.searchParams.get("error_description") || err || "المزوّد ما رجّع رمز الربط";
    return resultRedirect(origin, { ok: false, name: peek?.name, message: msg, back: peek?.back });
  }
  try {
    const { server, back } = await finishMcpOAuth(state, code);
    const tools = await syncTools(server);
    await connectLog(req, { kind: "mcp", step: "done", target: server.slug, message: `${tools} tools` });
    const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true, email: true } });
    if (owner) await audit(owner, "mcp.oauth_connected", { entityType: "mcp", entityId: server.id, details: { name: server.name, tools } });
    return resultRedirect(origin, { ok: true, name: server.name, back, tools });
  } catch (e) {
    await connectLog(req, { kind: "mcp", step: "error", target: peek?.name ?? null, ok: false, message: (e as Error).message });
    return resultRedirect(origin, { ok: false, name: peek?.name, message: (e as Error).message, back: peek?.back });
  }
}
