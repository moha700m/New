import { adminRoute } from "@/lib/admin";
import { encryptSecret, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { HttpError, json, parseBody } from "@/lib/http";
import { CONNECTOR_PRESETS, mcpSchema, redactMcp } from "@/lib/agent/mcp-admin";
import { getGithubConnection, githubPublicState } from "@/lib/agent/github";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const servers = await prisma.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
  return json({ servers: servers.map(redactMcp), presets: CONNECTOR_PRESETS, github: githubPublicState(await getGithubConnection()) });
});

export const POST = adminRoute(async ({ req, log }) => {
  const body = await parseBody(req, mcpSchema);
  if (await prisma.mcpServer.findUnique({ where: { slug: body.slug } })) throw new HttpError(409, "يوجد خادم MCP بنفس المعرّف");
  const { token, ...rest } = body;
  const s = await prisma.mcpServer.create({
    data: { ...rest, url: rest.url, extraHeaders: rest.extraHeaders ?? undefined, ...(token ? { tokenEncrypted: encryptSecret(token), tokenLast4: last4(token), authType: "token", connectedAt: new Date() } : {}) },
  });
  await log("mcp.create", { entityType: "mcp", entityId: s.id, details: { name: s.name, url: s.url, tokenSet: Boolean(token) } });
  return json({ server: redactMcp(s) }, 201);
});
