import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/http";
import { finishMcpOAuth, parsePastedCallback } from "@/lib/agent/oauth";
import { syncTools } from "@/lib/agent/connect-flow";
import { connectLog } from "@/lib/agent/connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Paste-back finish for providers that only allow a loopback redirect (owner pastes the localhost address). */
export const POST = handler(async (req: Request) => {
  const user = await requireAdmin();
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const p = parsePastedCallback(String(body.url ?? "").slice(0, 4000));
  if (p.error) return json({ ok: false, message: p.error === "access_denied" ? "ألغيت الربط من صفحة المزوّد" : p.errorDescription || p.error }, 400);
  if (!p.code || !p.state) return json({ ok: false, message: "الرابط اللي لصقته ما فيه رمز الربط — انسخ العنوان كامل من شريط المتصفح بعد ما تسجّل دخولك" }, 400);
  try {
    const { server, back } = await finishMcpOAuth(p.state, p.code);
    const tools = await syncTools(server);
    await connectLog(req, { kind: "mcp", step: "done", target: server.slug, message: `paste-back, ${tools} tools` });
    const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true, email: true } });
    await audit(owner ?? { id: user.id, email: user.email }, "mcp.oauth_connected", { entityType: "mcp", entityId: server.id, details: { name: server.name, tools, via: "paste" } });
    return json({ ok: true, name: server.name, tools, back });
  } catch (e) {
    await connectLog(req, { kind: "mcp", step: "error", target: null, ok: false, message: (e as Error).message });
    return json({ ok: false, message: (e as Error).message }, 400);
  }
});
