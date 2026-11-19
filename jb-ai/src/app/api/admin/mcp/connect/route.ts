import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { HttpError, json, parseBody } from "@/lib/http";
import { redactMcp } from "@/lib/agent/mcp-admin";
import { publicOrigin } from "@/lib/agent/oauth";
import { beginConnect, resolveServer } from "@/lib/agent/connect-flow";
import { connectLog, safeBack } from "@/lib/agent/connect";

export const maxDuration = 60;

const schema = z.object({ serverId: z.string().max(40).optional(), preset: z.string().max(40).optional(), back: z.string().max(300).optional() });

/** JSON variant of «ربط» (the UI prefers the full-page GET /api/connect/mcp). */
export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, schema);
  let server;
  try {
    server = await resolveServer(body);
    const r = await beginConnect(server, publicOrigin(req), safeBack(body.back));
    await connectLog(req, { kind: "mcp", step: r.connected ? "done" : "start", target: server.slug });
    if (r.connected) {
      await log("mcp.connect", { entityType: "mcp", entityId: server.id, details: { name: server.name, auth: "none", tools: r.toolCount } });
      return json({ connected: true, server: redactMcp(r.server) });
    }
    await log("mcp.oauth_start", { entityType: "mcp", entityId: server.id, details: { name: server.name, issuer: new URL(r.authorizeUrl).origin } });
    if (r.pasteBack) {
      const q = new URLSearchParams({ name: server.name, back: safeBack(body.back), go: r.authorizeUrl });
      return json({ connected: false, authorizeUrl: `/connect/paste?${q}` });
    }
    return json({ connected: false, authorizeUrl: r.authorizeUrl });
  } catch (e) {
    await connectLog(req, { kind: "mcp", step: "error", target: server?.slug ?? body.preset, ok: false, message: (e as Error).message });
    throw new HttpError(502, (e as Error).message);
  }
});
