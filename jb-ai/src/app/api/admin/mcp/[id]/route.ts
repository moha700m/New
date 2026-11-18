import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { encryptSecret, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { mcpSchema, redactMcp } from "@/lib/agent/mcp-admin";

const patchSchema = mcpSchema.partial().extend({ clearToken: z.boolean().optional() });

export const PATCH = adminRoute<{ id: string }>(async ({ req, params, log }) => {
  const body = await parseBody(req, patchSchema);
  const cur = await prisma.mcpServer.findUnique({ where: { id: params.id } });
  if (!cur) throw new HttpError(404, "الخادم غير موجود");
  if (body.slug && body.slug !== cur.slug && (await prisma.mcpServer.findUnique({ where: { slug: body.slug } }))) throw new HttpError(409, "المعرّف مستخدم مسبقًا");
  const { token, clearToken, ...rest } = body;
  const data: Record<string, unknown> = { ...rest };
  if (token) {
    data.tokenEncrypted = encryptSecret(token);
    data.tokenLast4 = last4(token);
    data.tools = undefined;
  } else if (clearToken) {
    data.tokenEncrypted = null;
    data.tokenLast4 = null;
  }
  // connection settings changed → tool cache is stale
  if (token || clearToken || rest.url || rest.transport || rest.extraHeaders) Object.assign(data, { tools: [], lastSyncAt: null });
  const s = await prisma.mcpServer.update({ where: { id: params.id }, data });
  await log(token ? "mcp.credentials_replaced" : "mcp.update", { entityType: "mcp", entityId: s.id, details: { name: s.name, changed: Object.keys(rest), tokenReplaced: Boolean(token), tokenCleared: Boolean(clearToken) } });
  return json({ server: redactMcp(s) });
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, log }) => {
  const s = await prisma.mcpServer.findUnique({ where: { id: params.id } });
  if (!s) throw new HttpError(404, "الخادم غير موجود");
  await prisma.mcpServer.delete({ where: { id: s.id } });
  await log("mcp.delete", { entityType: "mcp", entityId: s.id, details: { name: s.name } });
  return json({ ok: true });
});
