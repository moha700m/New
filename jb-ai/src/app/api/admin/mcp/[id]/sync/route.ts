import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { McpClient } from "@/lib/agent/mcp";
import { mcpHeaders } from "@/lib/agent/tools";
import { redactMcp } from "@/lib/agent/mcp-admin";

export const maxDuration = 60;

/** Connect to the server, run initialize + tools/list, and cache the tool list. */
export const POST = adminRoute<{ id: string }>(async ({ params, log }) => {
  const s = await prisma.mcpServer.findUnique({ where: { id: params.id } });
  if (!s) throw new HttpError(404, "الخادم غير موجود");
  const t0 = Date.now();
  const c = new McpClient({ url: s.url, transport: s.transport, headers: mcpHeaders(s), timeoutMs: 30_000 });
  try {
    await c.connect();
    const tools = await c.listTools();
    const updated = await prisma.mcpServer.update({ where: { id: s.id }, data: { tools: tools as any, lastSyncAt: new Date(), lastError: null } });
    await log("mcp.sync", { entityType: "mcp", entityId: s.id, details: { ok: true, tools: tools.length } });
    return json({ ok: true, latencyMs: Date.now() - t0, serverInfo: c.serverInfo, server: redactMcp(updated) });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const updated = await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: msg, lastSyncAt: new Date() } });
    await log("mcp.sync", { entityType: "mcp", entityId: s.id, details: { ok: false, error: msg.slice(0, 200) } });
    return json({ ok: false, latencyMs: Date.now() - t0, error: msg, server: redactMcp(updated) });
  } finally {
    await c.close();
  }
});
