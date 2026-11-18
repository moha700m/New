import { z } from "zod";
import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { json, parseBody } from "@/lib/http";
import { parseImport } from "@/lib/agent/mcp-import";
import { safeBack } from "@/lib/agent/connect";

const schema = z.object({ input: z.string().min(1).max(20_000), back: z.string().max(300).optional() });

/** «أضف موصّل»: a URL or a pasted MCP JSON config → a one-tap connect link (never stores pasted secrets). */
export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, schema);
  const back = safeBack(body.back);
  const r = parseImport(body.input, back);
  if (r.kind !== "remote") return json(r);
  const base = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "mcp";
  let server = await prisma.mcpServer.findFirst({ where: { url: r.url } });
  if (!server) {
    let slug = base;
    for (let i = 2; await prisma.mcpServer.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    server = await prisma.mcpServer.create({ data: { slug, name: r.name, url: r.url, transport: "auto" } });
    await log("mcp.create", { entityType: "mcp", entityId: server.id, details: { name: server.name, url: server.url, via: "import" } });
  }
  return json({ kind: "connect", name: server.name, href: `/api/connect/mcp?id=${server.id}&back=${encodeURIComponent(back)}` });
});
