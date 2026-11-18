import "server-only";
import type { McpServer } from "@prisma/client";
import { prisma } from "../db";
import { CONNECTOR_PRESETS } from "./mcp-admin";
import { probeMcp, startMcpOAuth } from "./oauth";
import { connectServer } from "./tools";

/** Finds (or creates from a preset) the MCP server row to connect. */
export async function resolveServer(q: { serverId?: string | null; preset?: string | null }) {
  if (q.serverId) {
    const s = await prisma.mcpServer.findUnique({ where: { id: q.serverId } });
    if (s) return s;
  }
  if (q.preset) {
    const p = CONNECTOR_PRESETS.find((x) => x.key === q.preset);
    if (!p) throw new Error("الموصّل غير معروف");
    return prisma.mcpServer.upsert({
      where: { slug: p.key },
      create: { slug: p.key, name: p.name, url: p.url, transport: "streamable" },
      update: { url: p.url, name: p.name },
    });
  }
  throw new Error("الموصّل غير موجود");
}

/** Loads the tool list right after connecting (failures are stored on the row, not thrown). */
export async function syncTools(s: McpServer) {
  try {
    const c = await connectServer(s, undefined, 30_000);
    try {
      const tools = await c.listTools();
      await prisma.mcpServer.update({ where: { id: s.id }, data: { tools: tools as any, lastSyncAt: new Date(), lastError: null, enabled: true } });
      return tools.length;
    } finally {
      await c.close();
    }
  } catch (e) {
    await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: (e as Error).message.slice(0, 500) } });
    return 0;
  }
}

/**
 * One-click "ربط": servers without auth are connected immediately; OAuth servers get discovery + dynamic
 * client registration + PKCE and return the provider's authorize URL (the browser navigates to it).
 */
export async function beginConnect(server: McpServer, origin: string, back = "/") {
  if (server.authType === "github") throw new Error("GitHub يتربط من زر «ربط GitHub»");
  const headers = (server.extraHeaders && typeof server.extraHeaders === "object" ? server.extraHeaders : {}) as Record<string, string>;
  let probe;
  try {
    probe = await probeMcp(server.url, headers);
  } catch (e) {
    throw new Error(`ما قدرت أوصل لخادم ${server.name}: ${(e as Error).message}`);
  }
  if (!probe.needsAuth) {
    const s0 = await prisma.mcpServer.update({ where: { id: server.id }, data: { authType: server.tokenEncrypted && server.authType === "token" ? "token" : "none", connectedAt: new Date() } });
    const c = await connectServer(s0, undefined, 30_000);
    try {
      const tools = await c.listTools();
      const s = await prisma.mcpServer.update({ where: { id: server.id }, data: { tools: tools as any, lastSyncAt: new Date(), lastError: null, enabled: true } });
      return { connected: true as const, server: s, toolCount: tools.length };
    } finally {
      await c.close();
    }
  }
  try {
    const authorizeUrl = await startMcpOAuth(server, origin, probe, back);
    return { connected: false as const, server, authorizeUrl };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    await prisma.mcpServer.update({ where: { id: server.id }, data: { lastError: msg } });
    throw new Error(`${server.name}: ${msg}`);
  }
}
