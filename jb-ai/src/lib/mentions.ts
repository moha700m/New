/**
 * @mentions in the composer: the user names a tool / deploy target / connector ("@GitHub انشره", "@موقعي").
 * Shared by the client (autocomplete) and the server (forces those tools into the agent run).
 * A mention is stored in the message text as "@Token" so it survives regenerate / edit.
 */
export type MentionKind = "builtin" | "deploy" | "connector";

export interface BuiltinMention {
  key: string;
  token: string;
  label: string;
  desc: string;
  kind: MentionKind;
  aliases: string[];
  /** needs this connector slug to be connected */
  needs?: string;
}

export const BUILTIN_MENTIONS: BuiltinMention[] = [
  { key: "site", token: "موقعي", label: "موقعي", desc: "استضافة فورية على رابط موقعك /s/…", kind: "deploy", aliases: ["site", "hosting", "استضافة", "موقع"] },
  { key: "github", token: "GitHub", label: "GitHub", desc: "مستودع + GitHub Pages", kind: "deploy", aliases: ["github", "جيت", "قيت", "جيتهب", "قيتهب", "pages"], needs: "github" },
  { key: "vercel", token: "Vercel", label: "Vercel", desc: "عن طريق GitHub — رابط استيراد بضغطة", kind: "deploy", aliases: ["vercel", "فيرسل", "فرسل"], needs: "github" },
  { key: "appdeploy", token: "AppDeploy", label: "App Deploy", desc: "تطبيق كامل (واجهة + باك + قاعدة بيانات) برابط حي — appdeploy.ai", kind: "deploy", aliases: ["appdeploy", "app", "deploy", "اب", "أب", "ابديبلوي", "اب دبلوي", "تطبيق", "ابلكيشن"], needs: "appdeploy" },
  { key: "search", token: "بحث", label: "بحث", desc: "بحث وقراءة صفحات الإنترنت", kind: "builtin", aliases: ["search", "web", "انترنت", "الإنترنت"] },
  { key: "image", token: "صورة", label: "صورة", desc: "توليد صور بدون قيود", kind: "builtin", aliases: ["image", "img", "صور", "تصميم"] },
];

/** Extra Arabic spellings for connectors so typing "@كلاود" finds Cloudflare. */
export const CONNECTOR_ALIASES: Record<string, string[]> = {
  cloudflare: ["كلاود", "كلاودفلير", "كلاود فلير", "workers", "ووركرز"],
  "cloudflare-builds": ["كلاود", "builds"],
  netlify: ["نتلفاي", "نتليفاي"],
  supabase: ["سوبابيس", "سوبا"],
  neon: ["نيون", "postgres"],
  railway: ["ريلوي", "ريل"],
  linear: ["لينير"],
  sentry: ["سنتري"],
  notion: ["نوشن"],
  stripe: ["سترايب"],
  zapier: ["زابير"],
  appdeploy: ["اب", "تطبيق", "app", "deploy"],
  exa: ["اكسا", "بحث"],
  huggingface: ["هقنق", "hf"],
  context7: ["توثيق", "docs"],
  deepwiki: ["ديب", "wiki"],
};

/** Token used in the text for a connector: its name when it's one word, else the slug ("@Cloudflare", "@cloudflare-builds"). */
export function connectorToken(name: string, slug: string) {
  return /^[\p{L}\p{N}._-]+$/u.test(name) ? name : slug;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");

/** All "@xxx" tokens in a text (Arabic/Latin letters, digits, . _ -). */
export function mentionTokens(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s(«"'،,])@([\p{L}\p{N}._-]{2,40})/gu)].map((m) => m[1]!.replace(/[.،,]+$/, ""));
}

export type ResolvedMention = { key: string; token: string; kind: MentionKind; label: string; needs?: string };

/** Resolve the tokens in a message against built-ins + connectors ({slug, name}). Unknown tokens are ignored. */
export function resolveMentions(text: string, connectors: { slug: string; name: string }[]): ResolvedMention[] {
  const out = new Map<string, ResolvedMention>();
  for (const t of mentionTokens(text)) {
    const n = norm(t);
    const b = BUILTIN_MENTIONS.find((x) => norm(x.token) === n || norm(x.key) === n);
    if (b) {
      out.set(b.key, { key: b.key, token: b.token, kind: b.kind, label: b.label, needs: b.needs });
      continue;
    }
    const c = connectors.find((x) => norm(x.slug) === n || norm(x.name) === n || norm(connectorToken(x.name, x.slug)) === n);
    if (c) out.set(c.slug, { key: c.slug, token: connectorToken(c.name, c.slug), kind: "connector", label: c.name });
  }
  return [...out.values()];
}
