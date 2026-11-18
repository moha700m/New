import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { CONNECTOR_PRESETS, redactMcp } from "@/lib/agent/mcp-admin";
import { probeMcp, publicOrigin, startMcpOAuth } from "@/lib/agent/oauth";
import { connectServer } from "@/lib/agent/tools";

export const maxDuration = 60;

const schema = z.object({ serverId: z.string().max(40).optional(), preset: z.string().max(40).optional() });

/**
 * One-click "ربط": detects whether the MCP server needs authorization.
 * - no auth → connects and loads the tools immediately;
 * - OAuth → discovery + dynamic client registration + PKCE, returns the provider's authorize URL for the browser.
 */
export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, schema);
  let server = body.serverId ? await prisma.mcpServer.findUnique({ where: { id: body.serverId } }) : null;
  if (!server && body.preset) {
    const p = CONNECTOR_PRESETS.find((x) => x.key === body.preset);
    if (!p) throw new HttpError(404, "الموصّل غير معروف");
    server = await prisma.mcpServer.upsert({ where: { slug: p.key }, create: { slug: p.key, name: p.name, url: p.url, transport: "streamable" }, update: {} });
  }
  if (!server) throw new HttpError(404, "الخادم غير موجود");
  if (server.authType === "github") throw new HttpError(400, "GitHub يتربط من زر «ربط GitHub»");

  const headers = (server.extraHeaders && typeof server.extraHeaders === "object" ? server.extraHeaders : {}) as Record<string, string>;
  let probe;
  try {
    probe = await probeMcp(server.url, headers);
  } catch (e) {
    throw new HttpError(502, `ما قدرت أوصل للخادم: ${(e as Error).message}`);
  }
  if (!probe.needsAuth) {
    const s0 = await prisma.mcpServer.update({ where: { id: server.id }, data: { authType: server.tokenEncrypted && server.authType === "token" ? "token" : "none" } });
    const c = await connectServer(s0, undefined, 30_000);
    try {
      const tools = await c.listTools();
      const s = await prisma.mcpServer.update({ where: { id: server.id }, data: { tools: tools as any, lastSyncAt: new Date(), lastError: null, connectedAt: new Date(), enabled: true } });
      await log("mcp.connect", { entityType: "mcp", entityId: s.id, details: { name: s.name, auth: "none", tools: tools.length } });
      return json({ connected: true, server: redactMcp(s) });
    } finally {
      await c.close();
    }
  }
  try {
    const authorizeUrl = await startMcpOAuth(server, publicOrigin(req), probe);
    await log("mcp.oauth_start", { entityType: "mcp", entityId: server.id, details: { name: server.name, issuer: new URL(authorizeUrl).origin } });
    return json({ connected: false, authorizeUrl });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    await prisma.mcpServer.update({ where: { id: server.id }, data: { lastError: msg } });
    throw new HttpError(502, msg);
  }
});
