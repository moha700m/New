import { adminRoute } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { redactMcp } from "@/lib/agent/mcp-admin";
import { disconnectGithub } from "@/lib/agent/github";

export const POST = adminRoute<{ id: string }>(async ({ params, log }) => {
  const s = await prisma.mcpServer.findUnique({ where: { id: params.id } });
  if (!s) throw new HttpError(404, "الخادم غير موجود");
  if (s.authType === "github") await disconnectGithub();
  const u = await prisma.mcpServer.update({
    where: { id: s.id },
    data: { tokenEncrypted: null, tokenLast4: null, refreshTokenEncrypted: null, tokenExpiresAt: null, connectedAs: null, connectedAt: null, tools: [] },
  });
  await log("mcp.disconnect", { entityType: "mcp", entityId: s.id, details: { name: s.name } });
  return json({ server: redactMcp(u) });
});
