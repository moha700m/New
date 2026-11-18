import { z } from "zod";

export const GITHUB_MCP_PRESET = {
  name: "GitHub",
  slug: "github",
  url: "https://api.githubcopilot.com/mcp/",
  transport: "streamable",
  authHeader: "Authorization",
  authScheme: "Bearer",
  extraHeaders: { "X-MCP-Toolsets": "context,repos,issues,pull_requests,users,actions" },
};

export const mcpSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,30}$/, "المعرّف: حروف إنجليزية صغيرة وأرقام و - _ فقط (حتى 31 حرف)"),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "الرابط لازم يبدأ بـ http(s)"),
  transport: z.enum(["auto", "streamable", "sse"]).default("auto"),
  authHeader: z.string().trim().max(80).default("Authorization"),
  authScheme: z.string().trim().max(40).default("Bearer"),
  token: z.string().max(4000).optional(),
  extraHeaders: z.record(z.string().max(2000)).optional(),
  toolFilter: z.string().max(4000).nullish(),
  enabled: z.boolean().default(true),
});

/** Never send the encrypted token to the browser. */
export function redactMcp<T extends { tokenEncrypted: string | null; tools: unknown }>(s: T) {
  const { tokenEncrypted, tools, ...rest } = s;
  const list = (Array.isArray(tools) ? tools : []) as { name: string; description?: string }[];
  return { ...rest, hasToken: Boolean(tokenEncrypted), toolCount: list.length, tools: list.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })) };
}
