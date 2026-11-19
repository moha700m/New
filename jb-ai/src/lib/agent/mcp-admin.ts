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

/**
 * Connector gallery (one-click «ربط»). Auth is auto-detected: OAuth 2.1 + dynamic client registration, or none.
 * Every OAuth entry here was verified to reach the provider's login page with our redirect URI.
 */
export const CONNECTOR_PRESETS = [
  // build & deploy
  { key: "appdeploy", cat: "build", name: "App Deploy", url: "https://api-v2.appdeploy.ai/mcp", desc: "انشر تطبيقات كاملة (واجهة + باك إند + قاعدة بيانات) برابط حي — appdeploy.ai" },
  { key: "netlify", cat: "build", name: "Netlify", url: "https://netlify-mcp.netlify.app/mcp", desc: "انشر مواقع وأنشئ مشاريع Netlify" },
  { key: "cloudflare", cat: "build", name: "Cloudflare", url: "https://mcp.cloudflare.com/mcp", desc: "كل حساب Cloudflare: Workers و Pages و DNS و R2 و D1" },
  { key: "cloudflare-builds", cat: "build", name: "Cloudflare Builds", url: "https://builds.mcp.cloudflare.com/mcp", desc: "بناءات ونشر Workers وسجلاتها" },
  { key: "supabase", cat: "build", name: "Supabase", url: "https://mcp.supabase.com/mcp", desc: "قواعد بيانات Postgres و Auth و Storage و Edge Functions" },
  { key: "neon", cat: "build", name: "Neon", url: "https://mcp.neon.tech/mcp", desc: "قواعد بيانات Postgres سحابية: أنشئ ونفّذ SQL" },
  { key: "railway", cat: "build", name: "Railway", url: "https://mcp.railway.com", desc: "انشر خدمات وتطبيقات وقواعد بيانات" },
  { key: "prisma", cat: "build", name: "Prisma Postgres", url: "https://mcp.prisma.io/mcp", desc: "قواعد بيانات Prisma Postgres وترحيلاتها" },
  { key: "webflow", cat: "build", name: "Webflow", url: "https://mcp.webflow.com/mcp", desc: "صمّم وعدّل مواقع Webflow و CMS" },
  { key: "wix", cat: "build", name: "Wix", url: "https://mcp.wix.com/mcp", desc: "مواقع Wix والمتاجر والمحتوى" },
  { key: "sentry", cat: "build", name: "Sentry", url: "https://mcp.sentry.dev/mcp", desc: "الأخطاء والتنبيهات في تطبيقاتك" },
  { key: "posthog", cat: "build", name: "PostHog", url: "https://mcp.posthog.com/mcp", desc: "تحليلات المنتج والـ feature flags" },
  // knowledge & web (no sign-in)
  { key: "exa", cat: "web", name: "Exa Search", url: "https://mcp.exa.ai/mcp", desc: "بحث ويب قوي وقراءة صفحات — بدون تسجيل" },
  { key: "context7", cat: "web", name: "Context7", url: "https://mcp.context7.com/mcp", desc: "توثيق محدّث لأي مكتبة برمجية — بدون تسجيل" },
  { key: "deepwiki", cat: "web", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", desc: "اشرح أي مستودع GitHub عام — بدون تسجيل" },
  { key: "cloudflare-docs", cat: "web", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp", desc: "توثيق Cloudflare — بدون تسجيل" },
  { key: "huggingface", cat: "web", name: "Hugging Face", url: "https://huggingface.co/mcp", desc: "نماذج و datasets و Spaces — بدون تسجيل" },
  // work & automation
  { key: "notion", cat: "work", name: "Notion", url: "https://mcp.notion.com/mcp", desc: "صفحاتك وقواعد بياناتك" },
  { key: "linear", cat: "work", name: "Linear", url: "https://mcp.linear.app/mcp", desc: "المهام والمشاريع" },
  { key: "atlassian", cat: "work", name: "Jira و Confluence", url: "https://mcp.atlassian.com/v1/mcp", desc: "تذاكر Jira وصفحات Confluence" },
  { key: "monday", cat: "work", name: "monday.com", url: "https://mcp.monday.com/mcp", desc: "اللوحات والمهام" },
  { key: "zapier", cat: "work", name: "Zapier", url: "https://mcp.zapier.com/api/mcp/mcp", desc: "آلاف التطبيقات والأتمتة" },
  { key: "apify", cat: "work", name: "Apify", url: "https://mcp.apify.com", desc: "سحب بيانات المواقع والـ scrapers" },
  { key: "stripe", cat: "work", name: "Stripe", url: "https://mcp.stripe.com", desc: "المدفوعات والعملاء" },
] as const;

export const CONNECTOR_CATEGORIES = [
  { key: "build", label: "بناء ونشر" },
  { key: "web", label: "بحث ومعرفة (بدون تسجيل)" },
  { key: "work", label: "عمل وأتمتة" },
] as const;
