import "server-only";
import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import { getPublicCatalog } from "../engine";
import { getAdapter } from "../providers";
import { joinUrl } from "../providers/http";
import { runtimeConfig } from "../providers";
import { violatesMinorSafety, MINOR_SAFETY_MESSAGE } from "../safety";
import { filterTools, McpClient, type McpToolInfo } from "./mcp";
import { oauthAccessToken } from "./oauth";
import { ghRest, githubUserToken } from "./github";

export interface ToolContext {
  userId: string;
  assistantMessageId: string;
  emit: (ev: Record<string, unknown>) => void;
  signal: AbortSignal;
}
export interface ToolOutput {
  text: string;
  /** Short human summary for the UI. */
  summary?: string;
}
export interface AgentTool {
  name: string; // model-facing (sanitized) name
  label: string; // UI label
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolOutput>;
}

const UA = "Mozilla/5.0 (compatible; JB-AI-Agent/1.0; +https://jb-ai-seven.vercel.app)";
const MAX_TOOL_TEXT = 15_000;

export function clip(s: string, n = MAX_TOOL_TEXT) {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}

function sigWith(signal: AbortSignal, ms: number) {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/** Basic SSRF guard: public http(s) URLs only. */
function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs are allowed");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || h === "metadata.google.internal"
  ) {
    throw new Error("private/internal addresses are not allowed");
  }
  return u;
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  let s = html
    .replace(/<(script|style|noscript|svg|head|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\s[^>]*href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `${t.replace(/<[^>]+>/g, "")} (${href})`)
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h(\d)[^>]*>/gi, (_m, n) => "\n" + "#".repeat(Number(n)) + " ")
    .replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title: title.replace(/\s+/g, " "), text: s };
}

// ------------------------------------------------------------------ built-in: web_fetch
const webFetch: AgentTool = {
  name: "web_fetch",
  label: "جلب صفحة",
  description: "Fetch a public web page or API URL and return its readable text (HTML is converted to text; JSON/text returned as-is). Use it to read pages found by web_search or URLs the user gives.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL" },
      max_chars: { type: "integer", description: "Maximum characters to return (default 12000, max 30000)" },
    },
    required: ["url"],
  },
  async run(args, ctx) {
    const u = assertPublicUrl(String(args.url ?? ""));
    const max = Math.min(Math.max(Number(args.max_chars) || 12000, 500), 30000);
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: sigWith(ctx.signal, 25_000) });
    assertPublicUrl(res.url || u.toString());
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    let body = raw;
    let title = "";
    if (/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(raw)) ({ title, text: body } = htmlToText(raw));
    return {
      text: `URL: ${res.url}\nStatus: ${res.status}\nContent-Type: ${ct}${title ? `\nTitle: ${title}` : ""}\n\n${clip(body, max)}`,
      summary: `${res.status} · ${title || ct.split(";")[0]} · ${body.length.toLocaleString("en")} حرف`,
    };
  },
};

// ------------------------------------------------------------------ built-in: web_search
async function ddgSearch(q: string, signal: AbortSignal) {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, signal: sigWith(signal, 9000) });
  if (!res.ok) throw new Error(`ddg ${res.status}`);
  const html = await res.text();
  const out: { title: string; url: string; snippet: string }[] = [];
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map((m) => htmlToText(m[1]!).text);
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) && out.length < 8) {
    let url = m[1] ?? m[3] ?? "";
    const title = htmlToText(m[2] ?? m[4] ?? "").text;
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith("//")) url = "https:" + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) {
      i++;
      continue; // ads
    }
    out.push({ title, url, snippet: snippets[i] ?? "" });
    i++;
  }
  if (!out.length) throw new Error("ddg: no results parsed");
  return out;
}

async function veniceSearch(q: string, signal: AbortSignal) {
  const model = await prisma.aiModel.findFirst({
    where: { enabled: true, supportsWebSearch: true, supportsText: true, provider: { type: "VENICE", enabled: true } },
    orderBy: [{ inputPricePerM: "asc" }],
    include: { provider: true },
  });
  if (!model) throw new Error("no Venice web-search model");
  const cfg = runtimeConfig(model.provider);
  if (!cfg.apiKey) throw new Error("Venice key missing");
  const res = await fetch(joinUrl(cfg.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: model.modelId,
      messages: [{ role: "user", content: `Search the web and list the most relevant findings (with sources) for: ${q}` }],
      max_tokens: 700,
      venice_parameters: { enable_web_search: "on", include_venice_system_prompt: false, enable_web_citations: true },
    }),
    signal: sigWith(signal, 45_000),
  });
  if (!res.ok) throw new Error(`venice search ${res.status}`);
  const j: any = await res.json();
  const cites: any[] = j?.venice_parameters?.web_search_citations ?? [];
  return {
    results: cites.slice(0, 8).map((c) => ({ title: String(c.title ?? ""), url: String(c.url ?? ""), snippet: String(c.content ?? "").slice(0, 400) })),
    summary: String(j?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
  };
}

const webSearch: AgentTool = {
  name: "web_search",
  label: "بحث في الويب",
  description: "Search the web. Returns a list of results (title, url, snippet). Follow up with web_fetch to read a result.",
  parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
  async run(args, ctx) {
    const q = String(args.query ?? "").trim();
    if (!q) throw new Error("query is required");
    try {
      const r = await ddgSearch(q, ctx.signal);
      return { text: r.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join("\n"), summary: `${r.length} نتيجة (DuckDuckGo)` };
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      const v = await veniceSearch(q, ctx.signal);
      const list = v.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join("\n");
      return { text: `${list || "(no citation list)"}\n\nSummary:\n${clip(v.summary, 4000)}`, summary: `${v.results.length} نتيجة (Venice search)` };
    }
  },
};

// ------------------------------------------------------------------ built-in: generate_image
const generateImage: AgentTool = {
  name: "generate_image",
  label: "توليد صورة",
  description: "Generate an image from a text prompt (no content filter except the legal ban on minors). The image is shown to the user automatically. Optionally pass a model name from the site's image models.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed image prompt (English works best)" },
      model: { type: "string", description: "Optional image model name, e.g. 'Lustify v8' or 'Z-Image Turbo'" },
      width: { type: "integer" },
      height: { type: "integer" },
    },
    required: ["prompt"],
  },
  async run(args, ctx) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    if (violatesMinorSafety(prompt)) throw new Error(MINOR_SAFETY_MESSAGE);
    const catalog = await getPublicCatalog();
    const images = catalog.models.filter((m) => m.capabilities.imageGeneration);
    const wanted = String(args.model ?? "").toLowerCase().trim();
    const pick = (wanted && (images.find((m) => m.name.toLowerCase() === wanted) ?? images.find((m) => m.name.toLowerCase().includes(wanted)))) || images.find((m) => m.id === catalog.defaults.image) || images[0];
    if (!pick) throw new Error("no image model is enabled");
    const row = await prisma.aiModel.findUniqueOrThrow({ where: { id: pick.id }, include: { provider: true } });
    const adapter = getAdapter(row.provider);
    if (!adapter.generateImage) throw new Error(`${row.provider.name} cannot generate images`);
    const w = Math.min(Math.max(Number(args.width) || 1024, 256), 1536);
    const h = Math.min(Math.max(Number(args.height) || 1024, 256), 1536);
    const r = await adapter.generateImage({ model: row.modelId, prompt, width: w, height: h, signal: ctx.signal });
    const ids: string[] = [];
    for (const img of r.images) {
      const buf = Buffer.from(img.base64, "base64");
      const att = await prisma.attachment.create({
        data: { userId: ctx.userId, messageId: ctx.assistantMessageId, filename: `image-${Date.now()}.${img.mimeType.split("/")[1]}`, mimeType: img.mimeType, size: buf.length, kind: "generated-image", data: buf },
      });
      ids.push(att.id);
      ctx.emit({ type: "image", attachmentId: att.id, mimeType: img.mimeType });
    }
    return { text: `Generated ${ids.length} image(s) with ${row.displayName}; already displayed to the user. Do not repeat the image data.`, summary: `${row.displayName} · ${ids.length} صورة` };
  },
};

export const BUILTIN_TOOLS: AgentTool[] = [webSearch, webFetch, generateImage];

// ------------------------------------------------------------------ MCP servers
type ServerRow = Awaited<ReturnType<typeof prisma.mcpServer.findMany>>[number];

/** Auth headers for a server: OAuth (auto-refresh), GitHub connection, or a static token (advanced fallback). */
export async function serverHeaders(s: ServerRow, forceRefresh = false): Promise<Record<string, string>> {
  const h: Record<string, string> = { ...((s.extraHeaders && typeof s.extraHeaders === "object" ? s.extraHeaders : {}) as Record<string, string>) };
  let tok: string | null = null;
  if (s.authType === "github") tok = await githubUserToken();
  else if (s.authType === "oauth") tok = await oauthAccessToken(s, forceRefresh);
  else if (s.tokenEncrypted) tok = decryptSecret(s.tokenEncrypted);
  if (tok) {
    const scheme = s.authType === "oauth" || s.authType === "github" ? "Bearer" : s.authScheme;
    h[s.authType === "oauth" || s.authType === "github" ? "Authorization" : s.authHeader || "Authorization"] = scheme ? `${scheme} ${tok}` : tok;
  }
  return h;
}

/** Connects (refreshing an OAuth token once on 401). */
export async function connectServer(s: ServerRow, signal?: AbortSignal, timeoutMs = 90_000) {
  let c = new McpClient({ url: s.url, transport: s.transport, headers: await serverHeaders(s), signal, timeoutMs });
  try {
    await c.connect();
  } catch (e) {
    if (s.authType !== "oauth" || !/HTTP 401/.test((e as Error).message)) throw e;
    c = new McpClient({ url: s.url, transport: s.transport, headers: await serverHeaders(s, true), signal, timeoutMs });
    await c.connect();
  }
  return c;
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

/** REST fallback for GitHub if the MCP server is unreachable or rejects the token. */
function githubRestTools(): AgentTool[] {
  const T = async () => {
    const t = await githubUserToken();
    if (!t) throw new Error("GitHub غير مربوط");
    return t;
  };
  const str = (v: unknown) => String(v ?? "").trim();
  const mk = (name: string, label: string, description: string, properties: Record<string, unknown>, required: string[], fn: (a: Record<string, any>, tok: string) => Promise<unknown>): AgentTool => ({
    name: `github__${name}`,
    label: `GitHub · ${label}`,
    description: `[GitHub] ${description}`,
    parameters: { type: "object", properties, required },
    async run(args) {
      const out = await fn(args, await T());
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 1);
      return { text: clip(text), summary: `${text.length.toLocaleString("en")} حرف` };
    },
  });
  const repoP = { owner: { type: "string" }, repo: { type: "string" } };
  return [
    mk("get_me", "حسابي", "Get the authenticated GitHub user.", {}, [], async (_a, t) => {
      const u = await ghRest(t, "GET", "/user");
      return { login: u.login, name: u.name, html_url: u.html_url };
    }),
    mk("list_repos", "المستودعات", "List repositories the user can access (most recently updated first).", { per_page: { type: "integer" } }, [], async (a, t) => {
      const r = await ghRest(t, "GET", `/user/repos?sort=updated&per_page=${Math.min(Number(a.per_page) || 50, 100)}`);
      return r.map((x: any) => ({ full_name: x.full_name, private: x.private, default_branch: x.default_branch, description: x.description, html_url: x.html_url }));
    }),
    mk("get_file_contents", "قراءة ملف/مجلد", "Read a file (decoded text) or list a directory in a repo.", { ...repoP, path: { type: "string", description: "Path, empty for root" }, ref: { type: "string", description: "Branch/sha (optional)" } }, ["owner", "repo"], async (a, t) => {
      const r = await ghRest(t, "GET", `/repos/${str(a.owner)}/${str(a.repo)}/contents/${str(a.path).replace(/^\/+/, "")}${a.ref ? `?ref=${encodeURIComponent(str(a.ref))}` : ""}`);
      if (Array.isArray(r)) return r.map((x: any) => ({ type: x.type, path: x.path, size: x.size }));
      return `path: ${r.path}\nsha: ${r.sha}\n\n${Buffer.from(r.content ?? "", "base64").toString("utf8")}`;
    }),
    mk("search_code", "بحث في الكود", "Search code on GitHub (GitHub code-search syntax, e.g. 'useState repo:owner/name').", { query: { type: "string" } }, ["query"], async (a, t) => {
      const r = await ghRest(t, "GET", `/search/code?per_page=20&q=${encodeURIComponent(str(a.query))}`);
      return (r.items ?? []).map((x: any) => ({ repo: x.repository?.full_name, path: x.path, url: x.html_url }));
    }),
    mk("create_branch", "فرع جديد", "Create a branch from another branch (default: the repo's default branch).", { ...repoP, branch: { type: "string" }, from_branch: { type: "string" } }, ["owner", "repo", "branch"], async (a, t) => {
      const base = `/repos/${str(a.owner)}/${str(a.repo)}`;
      const from = str(a.from_branch) || (await ghRest(t, "GET", base)).default_branch;
      const ref = await ghRest(t, "GET", `${base}/git/ref/heads/${encodeURIComponent(from)}`);
      const r = await ghRest(t, "POST", `${base}/git/refs`, { ref: `refs/heads/${str(a.branch)}`, sha: ref.object.sha });
      return { ref: r.ref, sha: r.object?.sha };
    }),
    mk("create_or_update_file", "كتابة ملف (commit)", "Create or update one file with a commit on a branch. Pass the full new file content.", { ...repoP, path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, ["owner", "repo", "path", "content", "message"], async (a, t) => {
      const url = `/repos/${str(a.owner)}/${str(a.repo)}/contents/${str(a.path).replace(/^\/+/, "")}`;
      let sha: string | undefined;
      try {
        sha = (await ghRest(t, "GET", `${url}${a.branch ? `?ref=${encodeURIComponent(str(a.branch))}` : ""}`)).sha;
      } catch {}
      const r = await ghRest(t, "PUT", url, { message: str(a.message), content: b64(String(a.content ?? "")), ...(a.branch ? { branch: str(a.branch) } : {}), ...(sha ? { sha } : {}) });
      return { commit: r.commit?.sha, url: r.commit?.html_url, path: r.content?.path };
    }),
    mk("create_pull_request", "فتح PR", "Open a pull request.", { ...repoP, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" } }, ["owner", "repo", "title", "head"], async (a, t) => {
      const base = str(a.base) || (await ghRest(t, "GET", `/repos/${str(a.owner)}/${str(a.repo)}`)).default_branch;
      const r = await ghRest(t, "POST", `/repos/${str(a.owner)}/${str(a.repo)}/pulls`, { title: str(a.title), head: str(a.head), base, body: String(a.body ?? "") });
      return { number: r.number, url: r.html_url };
    }),
    mk("list_issues", "القضايا", "List open issues and PRs of a repo.", { ...repoP, state: { type: "string" } }, ["owner", "repo"], async (a, t) => {
      const r = await ghRest(t, "GET", `/repos/${str(a.owner)}/${str(a.repo)}/issues?per_page=30&state=${str(a.state) || "open"}`);
      return r.map((x: any) => ({ number: x.number, title: x.title, state: x.state, pr: Boolean(x.pull_request), url: x.html_url }));
    }),
    mk("create_issue", "قضية جديدة", "Create an issue.", { ...repoP, title: { type: "string" }, body: { type: "string" } }, ["owner", "repo", "title"], async (a, t) => {
      const r = await ghRest(t, "POST", `/repos/${str(a.owner)}/${str(a.repo)}/issues`, { title: str(a.title), body: String(a.body ?? "") });
      return { number: r.number, url: r.html_url };
    }),
    mk("add_comment", "تعليق", "Comment on an issue or pull request.", { ...repoP, number: { type: "integer" }, body: { type: "string" } }, ["owner", "repo", "number", "body"], async (a, t) => {
      const r = await ghRest(t, "POST", `/repos/${str(a.owner)}/${str(a.repo)}/issues/${Number(a.number)}/comments`, { body: String(a.body ?? "") });
      return { url: r.html_url };
    }),
  ];
}

/** Builds agent tools for every enabled MCP server (from the cached tool list; refreshes servers that have none). */
export async function loadMcpTools(signal: AbortSignal): Promise<{ tools: AgentTool[]; close: () => Promise<void>; errors: string[] }> {
  const servers = await prisma.mcpServer.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  const clients = new Map<string, McpClient>();
  const errors: string[] = [];
  const tools: AgentTool[] = [];
  const used = new Set(BUILTIN_TOOLS.map((t) => t.name));

  async function client(s: ServerRow) {
    let c = clients.get(s.id);
    if (!c) {
      c = await connectServer(s, signal);
      clients.set(s.id, c);
    }
    return c;
  }

  for (const s of servers) {
    if ((s.authType === "oauth" || s.authType === "github") && !s.connectedAt) continue; // not connected yet
    let list = (Array.isArray(s.tools) ? s.tools : []) as unknown as McpToolInfo[];
    if (!list.length) {
      try {
        list = await (await client(s)).listTools();
        await prisma.mcpServer.update({ where: { id: s.id }, data: { tools: list as any, lastSyncAt: new Date(), lastError: null } });
      } catch (e) {
        if (s.authType === "github") {
          tools.push(...githubRestTools().filter((t) => !used.has(t.name)));
          continue;
        }
        errors.push(`${s.name}: ${(e as Error).message}`);
        continue;
      }
    }
    for (const t of filterTools(list, s.toolFilter)) {
      let name = sanitize(`${s.slug}__${t.name}`).slice(0, 64);
      for (let k = 2; used.has(name); k++) name = `${name.slice(0, 60)}_${k}`;
      used.add(name);
      tools.push({
        name,
        label: `${s.name} · ${t.name}`,
        description: `[MCP: ${s.name}] ${(t.description ?? "").slice(0, 900)}`,
        parameters: t.inputSchema && typeof t.inputSchema === "object" ? (t.inputSchema as Record<string, unknown>) : { type: "object", properties: {} },
        async run(args, ctx) {
          const c = await client(s);
          const r = await c.callTool(t.name, args);
          for (const img of r.images.slice(0, 2)) {
            const buf = Buffer.from(img.base64, "base64");
            const att = await prisma.attachment.create({ data: { userId: ctx.userId, messageId: ctx.assistantMessageId, filename: `mcp-${Date.now()}.${img.mimeType.split("/")[1]}`, mimeType: img.mimeType, size: buf.length, kind: "generated-image", data: buf } });
            ctx.emit({ type: "image", attachmentId: att.id, mimeType: img.mimeType });
          }
          if (r.isError) throw new Error(clip(r.text || "tool returned an error", 3000));
          return { text: r.text || "(empty result)", summary: `${r.text.length.toLocaleString("en")} حرف${r.images.length ? ` · ${r.images.length} صورة` : ""}` };
        },
      });
    }
  }
  return {
    tools,
    errors,
    close: async () => {
      await Promise.all([...clients.values()].map((c) => c.close().catch(() => {})));
    },
  };
}
