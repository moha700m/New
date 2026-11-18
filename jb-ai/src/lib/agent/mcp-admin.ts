import { z } from "zod";


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
export function redactMcp<T extends { tokenEncrypted: string | null; tools: unknown; refreshTokenEncrypted?: string | null; oauthClientSecretEncrypted?: string | null; oauthConfig?: unknown }>(s: T) {
  const { tokenEncrypted, tools, refreshTokenEncrypted, oauthClientSecretEncrypted, oauthConfig, ...rest } = s;
  const list = (Array.isArray(tools) ? tools : []) as { name: string; description?: string }[];
  const cfg = (oauthConfig ?? null) as { issuer?: string } | null;
  return { ...rest, oauthIssuer: cfg?.issuer ?? null, hasToken: Boolean(tokenEncrypted), toolCount: list.length, tools: list.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })) };
}

/** Connector gallery (one-click "ربط"). Auth is auto-detected: OAuth 2.1 + dynamic registration, or none. */
export const CONNECTOR_PRESETS = [
  { key: "vercel", name: "Vercel", url: "https://mcp.vercel.com", desc: "مشاريعك ونشراتك وسجلاتها على Vercel" },
  { key: "cloudflare", name: "Cloudflare", url: "https://bindings.mcp.cloudflare.com/mcp", desc: "Workers و KV و R2 و D1 في حسابك" },
  { key: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", desc: "صفحاتك وقواعد بياناتك في Notion" },
  { key: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", desc: "المهام والمشاريع في Linear" },
  { key: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", desc: "الأخطاء والتنبيهات في Sentry" },
  { key: "stripe", name: "Stripe", url: "https://mcp.stripe.com", desc: "المدفوعات والعملاء في Stripe" },
  { key: "huggingface", name: "Hugging Face", url: "https://huggingface.co/mcp", desc: "بحث النماذج والـ datasets والـ Spaces" },
  { key: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", desc: "توثيق أي مستودع GitHub عام" },
  { key: "context7", name: "Context7", url: "https://mcp.context7.com/mcp", desc: "توثيق محدّث للمكتبات البرمجية" },
] as const;
