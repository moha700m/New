import "server-only";
import { CONNECTOR_PRESETS } from "./mcp-admin";

/**
 * Understands what the owner pastes in «أضف موصّل»: a remote MCP URL, or a JSON MCP config (Claude/Cursor style,
 * with or without the "mcpServers" wrapper). Local (stdio / npx) servers can't run on a serverless site, so known
 * ones are mapped to their one-tap remote connector. Secrets inside a pasted config are never stored.
 */
export type ImportResult =
  | { kind: "connect"; href: string; name: string; note?: string }
  | { kind: "message"; message: string };

const KNOWN: { test: RegExp; preset?: string; github?: boolean; name: string }[] = [
  { test: /cloudflare/i, preset: "cloudflare", name: "Cloudflare" },
  { test: /github/i, github: true, name: "GitHub" },
  { test: /netlify/i, preset: "netlify", name: "Netlify" },
  { test: /supabase/i, preset: "supabase", name: "Supabase" },
  { test: /neon/i, preset: "neon", name: "Neon" },
  { test: /railway/i, preset: "railway", name: "Railway" },
  { test: /notion/i, preset: "notion", name: "Notion" },
  { test: /linear/i, preset: "linear", name: "Linear" },
  { test: /sentry/i, preset: "sentry", name: "Sentry" },
  { test: /stripe/i, preset: "stripe", name: "Stripe" },
  { test: /atlassian|jira|confluence/i, preset: "atlassian", name: "Jira و Confluence" },
  { test: /context7/i, preset: "context7", name: "Context7" },
  { test: /exa/i, preset: "exa", name: "Exa Search" },
  { test: /prisma/i, preset: "prisma", name: "Prisma Postgres" },
  { test: /zapier/i, preset: "zapier", name: "Zapier" },
];

function linkFor(k: (typeof KNOWN)[number], back: string) {
  return k.github ? `/api/connect/github?back=${encodeURIComponent(back)}` : `/api/connect/mcp?preset=${k.preset}&back=${encodeURIComponent(back)}`;
}

export function parseImport(input: string, back = "/"): ImportResult | { kind: "remote"; url: string; name: string } {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return { kind: "remote", url: t, name: new URL(t).hostname.replace(/^(mcp|api)\./, "").split(".")[0] ?? "MCP" };
  let j: any;
  try {
    j = JSON.parse(t.startsWith("{") ? t : `{${t.replace(/,\s*$/, "")}}`);
  } catch {
    return { kind: "message", message: "ما فهمت اللي لصقته — الصق رابط MCP يبدأ بـ https أو إعدادات JSON كاملة." };
  }
  const servers: Record<string, any> = j.mcpServers ?? j.servers ?? (j.command || j.url || j.serverUrl ? { mcp: j } : j);
  const [name, cfg] = Object.entries(servers)[0] ?? [];
  if (!name || !cfg || typeof cfg !== "object") return { kind: "message", message: "الإعدادات فاضية." };
  const url = cfg.url ?? cfg.serverUrl ?? cfg.httpUrl;
  const haystack = `${name} ${cfg.command ?? ""} ${(cfg.args ?? []).join(" ")} ${url ?? ""}`;
  const known = KNOWN.find((k) => k.test.test(haystack));
  const hadSecrets = Boolean(cfg.env && Object.keys(cfg.env).length) || Boolean(cfg.headers && Object.keys(cfg.headers).length);
  const secretNote = hadSecrets ? "ما خزّنت أي توكن من اللي لصقته — الربط يصير بتسجيل الدخول في موقعهم." : undefined;
  if (url && /^https?:\/\//i.test(url)) {
    if (known) return { kind: "connect", href: linkFor(known, back), name: known.name, note: secretNote };
    return { kind: "remote", url, name };
  }
  if (cfg.command) {
    if (known)
      return {
        kind: "connect",
        href: linkFor(known, back),
        name: known.name,
        note: `هذا خادم محلي (${cfg.command}) يشتغل على الكمبيوتر بس، فربطتك بنسخة ${known.name} السحابية الرسمية بنفس الصلاحيات — اضغط وسجّل دخول.${secretNote ? " " + secretNote : ""}`,
      };
    return { kind: "message", message: `«${name}» خادم محلي يشتغل بـ ${cfg.command} على الكمبيوتر، وموقعك سحابي ما يقدر يشغّله. لو له نسخة سحابية (رابط https) الصق رابطها.` };
  }
  return { kind: "message", message: "ما لقيت رابط أو أمر في الإعدادات." };
}

export const PRESET_KEYS = new Set(CONNECTOR_PRESETS.map((p) => p.key));
