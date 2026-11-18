import "server-only";
import { resolveMentions } from "../mentions";
import { CONNECTOR_PRESETS } from "./mcp-admin";
import type { AiModel, Provider } from "@prisma/client";
import { prisma } from "../db";
import { getAdapter, OpenAICompatibleAdapter, ProviderError, type ChatMessageInput } from "../providers";
import { toOpenAIMessages } from "../providers/openai-compatible";
import { BUILTIN_TOOLS, clip, loadMcpTools, type AgentTool, type ToolGroup } from "./tools";

export const MAX_AGENT_STEPS = 30;

export interface AgentStep {
  id: string;
  kind: "tool" | "note" | "info" | "plan";
  name?: string;
  label?: string;
  args?: string;
  status?: "running" | "ok" | "error";
  summary?: string;
  result?: string;
  ms?: number;
  text?: string;
  items?: { text: string; status: "pending" | "in_progress" | "done" }[];
}

type Emit = (ev: Record<string, unknown>) => void;
type Usage = { promptTokens?: number; completionTokens?: number; costUsd?: number };

function addUsage(a: Usage, b: Usage): Usage {
  const s = (x?: number, y?: number) => (x == null && y == null ? undefined : (x ?? 0) + (y ?? 0));
  return { promptTokens: s(a.promptTokens, b.promptTokens), completionTokens: s(a.completionTokens, b.completionTokens), costUsd: s(a.costUsd, b.costUsd) };
}

function argsSummary(args: Record<string, unknown>) {
  const s = JSON.stringify(args);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

function systemPrompt(tools: AgentTool[], mcpErrors: string[], extraConnectors: ToolGroup[] = []) {
  const now = new Date().toISOString().slice(0, 10);
  return [
    `You are «محمد | التقني» agent — an autonomous assistant that completes tasks end-to-end using tools (like Claude Code). Today is ${now}.`,
    `Work in steps: think briefly, call tools, read their results, fix errors and retry with different inputs, and continue until the task is fully done. You may use up to ${MAX_AGENT_STEPS} tool calls.`,
    "Never invent tool results. Prefer reading before writing (e.g. read a repo file before editing it).",
    "For any multi-step task, FIRST call update_plan with 3–6 short Arabic steps, then keep it current (mark a step in_progress when you start it and done when finished) — the user watches this checklist live.",
    "If a tool fails, read the error, fix the cause and retry (different input, another tool, or a fallback route) instead of giving up. Small fixes to a file: edit_file. To change a site published earlier: load_site → edit_file/write_files → publish_site with the same slug.",
    "You are also a senior full-stack web engineer and product designer. When asked to build a site/app:",
    "1) PLAN briefly (pages, sections, content, colors) — fill missing details with smart defaults instead of asking; use the user's real details (names, prices, phone numbers) exactly.",
    "2) BUILD complete, production-quality files — never placeholders like 'lorem ipsum' or 'add content here'. Defaults: semantic HTML5, mobile-first responsive CSS (flex/grid, clamp() type scale), Arabic content → <html lang=\"ar\" dir=\"rtl\"> with IBM Plex Sans Arabic from Google Fonts, accessible contrast, 44px tap targets, smooth subtle animations, NO horizontal scrolling on a 360px phone (html,body{overflow-x:hidden}, max-width:100% on media, no fixed widths wider than the screen, decorative blobs clipped), meta viewport + description + Open Graph tags, favicon (inline SVG emoji is fine), fast (no heavy frameworks for static sites; Tailwind CDN allowed). WhatsApp links: https://wa.me/<digits>. Images: generated ones (attachment_id), https://images.unsplash.com/… photos, or CSS/SVG art.",
    "   Use write_files to put the project into the workspace (split big projects across calls: index.html, styles.css, app.js…).",
    "3) SHIP — pick the best available route and do it yourself:",
    "   • Instant public link (always available): publish_site with just {slug, title} — it publishes the workspace files you already wrote. NEVER paste the file contents again into publish_site (it doubles the time); only pass files for generated images ({path, attachment_id}).",
    "   • GitHub (if github__* tools exist): github__create_repo (public) → github__push_files (no files = whole workspace) → github__enable_pages → live at https://<owner>.github.io/<repo>/. Vercel/Netlify/Cloudflare one-tap: github__deploy_links and give those links (the user taps once, signs in, and the repo deploys; future pushes redeploy automatically).",
    "   • Cloudflare / Netlify / Supabase / Neon / Railway connector tools (names start with the connector) — use them directly when the user asks for that platform (e.g. Cloudflare tools can create Workers/Pages; Netlify tools can create sites and deploy).",
    "Keep it fast: write the files in 1–3 write_files calls, then publish_site {slug,title} once — don't rewrite or republish without a reason.",
    "4) VERIFY with check_url on the EXACT url the deploy tool returned (never guess or invent other domains), on every live URL, with expect_text = a distinctive real string from the page (e.g. the business name). GitHub Pages can take ~1 minute: retry. If broken or the text is missing, fix and redeploy.",
    "5) REPORT in short Saudi Arabic: what was built, the live link(s) first, and what the user can ask next.",
    "Be efficient: about 4 minutes in total per task — few, large tool calls; at most 2 generated images (1024x1024) and only when really useful.",
    `Available tools: ${tools.map((t) => t.name).join(", ") || "(none)"}.`,
    extraConnectors.length
      ? `More connected connectors (their tools load on demand — call use_connector first when the task needs them): ${extraConnectors.map((g) => `${g.slug} (${g.name}, ${g.tools.length} tools)`).join(", ")}.`
      : "",
    mcpErrors.length ? `Note: these connectors are unavailable right now (ignore them, don't mention unless relevant): ${mcpErrors.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Final answer when the model ran out of time: list what was done and any links produced. */
function timeoutAnswer(steps: AgentStep[], reason?: string) {
  const done = steps.filter((s) => s.kind === "tool" && s.status === "ok");
  const links = [...new Set(done.flatMap((s) => (`${s.summary ?? ""} ${s.result ?? ""}`.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [])))].slice(0, 8);
  return [
    reason ? `⚠️ النموذج ما رد في الخطوة الأخيرة (${reason}).` : "⏱️ الوقت المسموح للمهمة خلص قبل ما يكمّل النموذج الرد الأخير.",
    done.length ? `تم تنفيذ ${done.length} خطوة: ${done.map((s) => s.label ?? s.name).join("، ")}.` : "",
    links.length ? `الروابط:\n${links.map((l) => `- ${l}`).join("\n")}` : "",
    "قل «كمل» وأكمل من حيث وقفت.",
  ].filter(Boolean).join("\n\n");
}

function reactProtocol(tools: AgentTool[]) {
  const lines = tools.map((t) => {
    const props = (t.parameters?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
    const req = new Set((t.parameters?.required as string[] | undefined) ?? []);
    const params = Object.entries(props)
      .map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${v?.type ?? "any"}${v?.description ? ` — ${String(v.description).slice(0, 120)}` : ""}`)
      .join("; ");
    return `- ${t.name}: ${t.description.slice(0, 300)}${params ? `\n  params: ${params}` : ""}`;
  });
  return [
    "TOOL PROTOCOL (your model has no native function calling, so use this text protocol):",
    "To call a tool, reply with a short thought (optional) followed by exactly ONE fenced JSON block and nothing after it:",
    '```json\n{"tool": "<tool name>", "args": { ... }}\n```',
    "You will then receive a message starting with TOOL_RESULT. Call one tool per reply. When the task is done, reply with the final answer and NO JSON tool block.",
    "Tools:",
    ...lines,
  ].join("\n");
}

function parseAction(text: string): { tool: string; args: Record<string, unknown>; before: string } | null {
  const candidates: { json: string; start: number }[] = [];
  for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) candidates.push({ json: m[1]!.trim(), start: m.index! });
  const idx = text.search(/\{\s*"tool"\s*:/);
  if (idx >= 0) {
    let depth = 0;
    let inStr = false;
    for (let i = idx; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        candidates.push({ json: text.slice(idx, i + 1), start: idx });
        break;
      }
    }
  }
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.json);
      if (o && typeof o.tool === "string") {
        const a = o.args ?? o.arguments ?? o.input ?? o.parameters ?? {};
        return { tool: o.tool, args: typeof a === "object" && a ? a : {}, before: text.slice(0, c.start).trim() };
      }
    } catch {}
  }
  return null;
}

export async function runAgent(opts: {
  model: AiModel & { provider: Provider };
  contextMessages: ChatMessageInput[];
  userId: string;
  assistantMessageId: string;
  emit: Emit;
  signal: AbortSignal;
  /** Called once something visible happened (a step), so callers stop retrying/falling back. */
  onProgress?: () => void;
}): Promise<{ text: string; reasoning: string; usage: Usage; steps: AgentStep[] }> {
  const { model, emit, signal } = opts;
  // Serverless functions stop at 300 s: keep a budget, cap each model call / tool, and force a final answer in time.
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;
  const remaining = () => DEADLINE_MS - (Date.now() - startedAt);
  const callSignal = (capMs: number) => AbortSignal.any([signal, AbortSignal.timeout(Math.max(15_000, Math.min(capMs, remaining())))]);
  const adapter = getAdapter(model.provider);
  const steps: AgentStep[] = [];
  let usage: Usage = {};
  let reasoning = "";
  let seq = 0;

  const persist = () => prisma.message.update({ where: { id: opts.assistantMessageId }, data: { agentSteps: steps as any } }).catch(() => {});
  const pushStep = (s: Omit<AgentStep, "id">) => {
    const step = { id: `s${++seq}`, ...s } as AgentStep;
    steps.push(step);
    if (s.kind !== "info") opts.onProgress?.();
    emit({ type: "agent_step", step });
    return step;
  };
  const updateStep = (step: AgentStep, patch: Partial<AgentStep>) => {
    Object.assign(step, patch);
    emit({ type: "agent_step", step });
  };
  /** Live status line for the UI: what the agent is doing right now. */
  const setPhase = (phase: string, label: string, detail?: string | null) => emit({ type: "agent_status", phase, label, detail: detail ?? null, elapsedMs: Date.now() - startedAt });
  const PHASES: Record<string, [string, string]> = {
    update_plan: ["plan", "يرتّب الخطة"],
    web_search: ["research", "يبحث في الإنترنت"],
    web_fetch: ["research", "يقرأ صفحة"],
    generate_image: ["design", "يصمّم صورة"],
    write_files: ["build", "يكتب الملفات"],
    edit_file: ["build", "يعدّل الملفات"],
    read_files: ["build", "يراجع الملفات"],
    load_site: ["build", "يفتح الموقع المنشور"],
    publish_site: ["deploy", "ينشر الموقع"],
    check_url: ["verify", "يتحقق من الرابط"],
    use_connector: ["tools", "يجهّز أدوات الموصّل"],
  };
  const phaseOf = (name: string, label?: string): [string, string] =>
    PHASES[name] ??
    (/^github__(create_repo|push_files|enable_pages|deploy_links|merge)/.test(name)
      ? ["deploy", "ينشر على GitHub"]
      : /search/i.test(name)
        ? ["research", `يبحث${label ? ` · ${label.split(" · ")[0]}` : ""}`]
        : /fetch|crawl|scrape|read/i.test(name)
          ? ["research", `يقرأ صفحة${label ? ` · ${label.split(" · ")[0]}` : ""}`]
          : ["tools", `يستخدم ${label ?? name}`]);
  setPhase("start", "يجهّز الأدوات");

  // Built-in tools are always available; connectors load in parallel with a short per-server timeout and never block.
  const mcp = await loadMcpTools(signal).catch((e) => {
    console.error("[agent] loading connectors failed", e);
    return { groups: [] as ToolGroup[], tools: [] as AgentTool[], errors: [] as string[], reconnect: [] as string[], close: async () => {} };
  });
  const lastUser = [...opts.contextMessages].reverse().find((m) => m.role === "user")?.content?.toLowerCase() ?? "";
  const ALIASES: Record<string, string[]> = {
    cloudflare: ["cloudflare", "كلاود فلير", "كلاودفلير", "كلاوفلير", "workers", "ووركرز"],
    "cloudflare-builds": ["cloudflare", "كلاود فلير", "كلاودفلير"],
    netlify: ["netlify", "نتلفاي", "نتليفاي"],
    supabase: ["supabase", "سوبابيس", "سوبا بيس"],
    neon: ["neon", "نيون"],
    railway: ["railway", "ريلوي", "ريل واي"],
    linear: ["linear", "لينير"],
    sentry: ["sentry", "سنتري"],
    notion: ["notion", "نوشن"],
    stripe: ["stripe", "سترايب"],
    zapier: ["zapier", "زابير"],
  };
  const mentioned = (g: ToolGroup) => [g.slug, g.name.toLowerCase(), ...(ALIASES[g.slug] ?? [])].some((k) => k && lastUser.includes(k));
  const MAX_ACTIVE = 70;
  const active = new Set<string>(["update_plan", ...BUILTIN_TOOLS.map((t) => t.name)]);
  const activate = (g: ToolGroup, filter?: string) => {
    const words = (filter ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
    const pick = words.length ? g.tools.filter((t) => words.some((w) => `${t.name} ${t.description}`.toLowerCase().includes(w))) : g.tools;
    const room = Math.max(0, MAX_ACTIVE + 40 - active.size);
    const chosen = pick.slice(0, Math.min(words.length ? 40 : 30, room));
    chosen.forEach((t) => active.add(t.name));
    return { chosen, total: pick.length };
  };
  const groups = mcp.groups;
  for (const g of groups) if (g.core) g.tools.forEach((t) => active.add(t.name));
  for (const g of groups) if (!g.core && (mentioned(g) || g.tools.length <= 6) && active.size + Math.min(g.tools.length, 30) <= MAX_ACTIVE) activate(g);
  // @mentions: the user picked exact tools / deploy targets — force them in and tell the model to use exactly those.
  const lastUserRaw = [...opts.contextMessages].reverse().find((m) => m.role === "user")?.content ?? "";
  const mentions = resolveMentions(
    lastUserRaw,
    groups.map((g) => ({ slug: g.slug, name: g.name })),
  );
  // a mention of a connector that exists in admin but failed to load / isn't connected
  const knownSlugs = new Set(groups.map((g) => g.slug));
  const missingMentions: string[] = [];
  for (const m of mentions) {
    if (m.kind === "connector") {
      const g = groups.find((x) => x.slug === m.key)!;
      if (!g.core) g.tools.slice(0, 40).forEach((t) => active.add(t.name));
    } else if (m.needs && !knownSlugs.has(m.needs)) missingMentions.push(m.label);
  }
  for (const p of resolveMentions(lastUserRaw, CONNECTOR_PRESETS.map((x) => ({ slug: x.key, name: x.name })))) {
    if (p.kind === "connector" && !knownSlugs.has(p.key)) missingMentions.push(p.label);
  }
  const mentionNote = mentions.length
    ? [
        "",
        `THE USER @MENTIONED THESE TARGETS — use exactly them: ${mentions.map((m) => `@${m.token}`).join(", ")}.`,
        mentions.some((m) => m.kind === "deploy" || m.kind === "connector")
          ? [
              "Deploy/publish ONLY to the mentioned target(s):",
              mentions.some((m) => m.key === "site") ? "• @موقعي → publish_site (instant link on this site)." : "• Do NOT use publish_site (the user did not ask for the built-in hosting).",
              mentions.some((m) => m.key === "github") ? "• @GitHub → github__create_repo (public) → github__push_files (workspace) → github__enable_pages, then check_url the github.io link (Pages can take ~1 min: retry) and give the repo + live link." : "",
              mentions.some((m) => m.key === "vercel") ? "• @Vercel → push to GitHub (create_repo + push_files) then github__deploy_links and give the Vercel import link (one tap)." : "",
              ...mentions.filter((m) => m.kind === "connector").map((m) => `• @${m.token} → use the ${m.label} connector tools (${m.key}__*) for this; if a needed tool isn't loaded call use_connector {connector:"${m.key}"} with a filter.`),
            ]
              .filter(Boolean)
              .join("\n")
          : "",
        mentions.some((m) => m.key === "search") ? "• @بحث → research with web_search / web_fetch first." : "",
        mentions.some((m) => m.key === "image") ? "• @صورة → create the images with generate_image." : "",
        missingMentions.length ? `NOT CONNECTED: ${missingMentions.join(", ")} — don't fake it: tell the user (in Arabic) to tap «ربط» for it in the connectors menu (🔌), and stop.` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const lazyGroups = () => groups.filter((g) => !g.core && g.tools.some((t) => !active.has(t.name)));
  const useConnector: AgentTool = {
    name: "use_connector",
    label: "تحميل أدوات موصّل",
    description: "Load the tools of a connected connector so you can call them (e.g. Cloudflare, Netlify, Supabase, Neon, Linear, Sentry). Optional 'filter' = keywords to pick specific tools (e.g. 'worker deploy', 'project create'). Returns the loaded tool names.",
    parameters: { type: "object", properties: { connector: { type: "string", description: "Connector slug", enum: groups.filter((g) => !g.core).map((g) => g.slug) }, filter: { type: "string", description: "Optional keywords" } }, required: ["connector"] },
    async run(args) {
      const g = groups.find((x) => x.slug === String(args.connector ?? "").trim() || x.name.toLowerCase() === String(args.connector ?? "").trim().toLowerCase());
      if (!g) throw new Error(`Unknown connector. Available: ${groups.filter((x) => !x.core).map((x) => x.slug).join(", ")}`);
      const { chosen, total } = activate(g, typeof args.filter === "string" ? args.filter : undefined);
      const rest = g.tools.filter((t) => !active.has(t.name)).map((t) => t.name);
      const text = [
        `Loaded ${chosen.length} of ${total} matching ${g.name} tools. You can call them now:`,
        ...chosen.map((t) => `- ${t.name}: ${t.description.replace(/^\[MCP: [^\]]+\]\s*/, "").slice(0, 160)}`),
        rest.length ? `Not loaded (call use_connector again with a filter): ${rest.slice(0, 80).join(", ")}` : "",
      ].filter(Boolean).join("\n");
      return { text, summary: `${chosen.length} أداة من ${g.name}` };
    },
  };
  let planStep: AgentStep | null = null;
  const updatePlan: AgentTool = {
    name: "update_plan",
    label: "الخطة",
    description: "Create or update the visible task checklist. Pass the FULL list each time: items = [{text (short Arabic), status: pending|in_progress|done}]. Call it first for multi-step tasks and whenever a step starts/finishes.",
    parameters: {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["text", "status"] } } },
      required: ["items"],
    },
    async run(args) {
      let raw: unknown = args.items;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {}
      }
      const items = (Array.isArray(raw) ? raw : [])
        .slice(0, 12)
        .map((x: any) => ({ text: String(x?.text ?? x?.title ?? x ?? "").slice(0, 120), status: (["pending", "in_progress", "done"].includes(x?.status) ? x.status : "pending") as "pending" | "in_progress" | "done" }))
        .filter((x) => x.text);
      if (!items.length) throw new Error("items is empty");
      if (!planStep) planStep = pushStep({ kind: "plan", items });
      else updateStep(planStep, { items });
      void persist();
      const done = items.filter((x) => x.status === "done").length;
      return { text: `Plan updated (${done}/${items.length} done). Continue with the next step.`, summary: `${done}/${items.length}` };
    },
  };
  const allTools = [updatePlan, ...BUILTIN_TOOLS, ...mcp.tools, ...(groups.some((g) => !g.core) ? [useConnector] : [])];
  if (allTools.includes(useConnector)) active.add(useConnector.name);
  const byName = new Map(allTools.map((t) => [t.name, t]));
  const activeTools = () => allTools.filter((t) => active.has(t.name));
  const tools = allTools;
  const toolCtx = { userId: opts.userId, assistantMessageId: opts.assistantMessageId, emit, signal, workspace: new Map<string, string>() };
  if (mcp.reconnect.length) pushStep({ kind: "info", text: `${mcp.reconnect.join(" و")}: الربط انتهى — اضغط «ربط» مرة ثانية من الموصّلات. كمّلت بدونه.` });

  async function execTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = byName.get(name);
    const [ph, phLabel] = phaseOf(name, tool?.label);
    setPhase(ph, phLabel);
    if (name === "update_plan" && tool) {
      try {
        return (await tool.run(args, { ...toolCtx })).text;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    }
    const step = pushStep({ kind: "tool", name, label: tool?.label ?? name, args: argsSummary(args), status: "running" });
    const t0 = Date.now();
    if (!tool) {
      updateStep(step, { status: "error", result: `Unknown tool "${name}"`, ms: 0 });
      void persist();
      return `ERROR: unknown tool "${name}". Available: ${activeTools().map((t) => t.name).join(", ")}`;
    }
    try {
      // models sometimes send arrays/objects as JSON strings: coerce by the declared parameter type
      const props = ((tool.parameters as { properties?: Record<string, { type?: string }> }).properties ?? {});
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string" && (props[k]?.type === "array" || props[k]?.type === "object")) {
          try {
            args[k] = JSON.parse(v);
          } catch {}
        }
      }
      const tsig = callSignal(120_000);
      const out = await Promise.race([
        tool.run(args, { ...toolCtx, signal: tsig }),
        new Promise<never>((_, rej) => tsig.addEventListener("abort", () => rej(new Error(signal.aborted ? "stopped" : "tool timed out")), { once: true })),
      ]);
      updateStep(step, { status: "ok", summary: out.summary, result: clip(out.text, 4000), ms: Date.now() - t0 });
      void persist();
      return clip(out.text);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      updateStep(step, { status: "error", result: msg.slice(0, 2000), ms: Date.now() - t0 });
      void persist();
      if (signal.aborted) throw e;
      return `ERROR: ${msg.slice(0, 3000)}`;
    }
  }

  /** One model call with a per-step timeout; retries rate limits / 5xx / timeouts with backoff instead of hanging. */
  async function callModel<T>(capMs: number, fn: (sig: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(callSignal(capMs));
      } catch (e) {
        if (signal.aborted) throw e;
        const pe = e instanceof ProviderError ? e : null;
        const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" || /timed? ?out|aborted/i.test((e as Error)?.message ?? "");
        const retry = timedOut || pe?.retryable || pe?.status === 429;
        if (!retry || attempt >= 2 || remaining() < 50_000) {
          if (timedOut && !pe) throw new ProviderError("النموذج تأخر في الرد", 408, true, true);
          throw e;
        }
        pushStep({ kind: "info", text: pe?.status === 429 ? `المزوّد مزحوم — أعيد المحاولة (${attempt + 1}/2)…` : `النموذج تأخر — أعيد المحاولة (${attempt + 1}/2)…` });
        await new Promise((r) => setTimeout(r, pe?.status === 429 ? 4000 * (attempt + 1) : 1000));
      }
    }
  }
  const STEP_MS = 120_000;
  const sysFor = () => systemPrompt(activeTools(), mcp.errors, lazyGroups()) + mentionNote;
  const sys = sysFor();
  const maxTokens = model.maxOutputTokens ? Math.min(model.maxOutputTokens, 16384) : 8192;
  const ctxMsgs = model.supportsVision ? opts.contextMessages : opts.contextMessages.map((m) => ({ ...m, images: undefined }));
  let finalText = "";
  let toolCalls = 0;

  try {
    let native = adapter instanceof OpenAICompatibleAdapter && model.supportsTools;

    // ---------------------------------------------------------------- native function calling
    if (native) {
      const oa = adapter as OpenAICompatibleAdapter;
      const messages: Record<string, unknown>[] = [{ role: "system", content: sys }, ...(toOpenAIMessages(ctxMsgs) as Record<string, unknown>[])];
      const specFor = () => activeTools().map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description.slice(0, 1000), parameters: t.parameters } }));
      for (let round = 0; ; round++) {
        if (signal.aborted) break;
        const limitHit = toolCalls >= MAX_AGENT_STEPS || remaining() < 45_000;
        if (limitHit) messages.push({ role: "user", content: `Time/tool budget reached. Stop calling tools and give the final answer now with what you have (include any links already produced).` });
        let r;
        try {
          messages[0] = { role: "system", content: sysFor() };
          const spec = limitHit ? undefined : specFor();
          setPhase(round === 0 ? "plan" : limitHit ? "report" : "thinking", round === 0 ? "يفهم الطلب ويخطط" : limitHit ? "يكتب الملخص" : "يفكّر في الخطوة الجاية");
          let lastTick = 0;
          let streamedReasoning = false;
          const onDelta = (d: { content?: string; reasoning?: string; tool?: string; argChars?: number }) => {
            if (d.reasoning) {
              streamedReasoning = true;
              reasoning += d.reasoning;
              emit({ type: "reasoning", text: d.reasoning });
            }
            const now = Date.now();
            if (now - lastTick < 600) return;
            lastTick = now;
            if (d.tool) {
              const [ph, lbl] = phaseOf(d.tool, byName.get(d.tool)?.label);
              const kb = ((d.argChars ?? 0) / 1024).toFixed(1);
              const big = d.tool === "write_files" || d.tool === "publish_site" || d.tool === "edit_file" || /push_files|create_or_update_file/.test(d.tool);
              setPhase(ph, d.tool === "write_files" ? "يكتب الكود" : lbl, big && (d.argChars ?? 0) > 200 ? `${kb} ك.ب` : null);
            } else if (d.content) setPhase("report", "يكتب الرد");
          };
          r = await callModel(limitHit ? 40_000 : STEP_MS, (sig) => oa.completeWithTools({ model: model.modelId, messages, tools: spec, maxTokens, signal: sig, onDelta }));
          if (streamedReasoning) r = { ...r, reasoning: "" };
        } catch (e) {
          if (round === 0 && e instanceof ProviderError && (e.status === 400 || e.status === 422) && !signal.aborted) {
            pushStep({ kind: "info", text: "النموذج ما يدعم استدعاء الأدوات مباشرة — كمّلت بطريقة نصية بديلة." });
            native = false;
            break;
          }
          if (!signal.aborted && round > 0) {
            finalText = timeoutAnswer(steps, (e as Error).message?.slice(0, 160));
            native = true;
            break;
          }
          throw e;
        }
        usage = addUsage(usage, r.usage);
        if (r.reasoning) {
          reasoning += (reasoning ? "\n\n" : "") + r.reasoning;
          emit({ type: "reasoning", text: r.reasoning });
        }
        if (!r.toolCalls.length || limitHit) {
          finalText = r.content;
          break;
        }
        if (r.content.trim()) pushStep({ kind: "note", text: r.content.trim().slice(0, 2000) });
        messages.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
        for (const c of r.toolCalls) {
          if (signal.aborted) break;
          let args: Record<string, unknown> = {};
          let result: string;
          try {
            args = c.arguments.trim() ? JSON.parse(c.arguments) : {};
            toolCalls++;
            result = toolCalls > MAX_AGENT_STEPS ? "ERROR: tool-call limit reached; answer now." : await execTool(c.name, args);
          } catch (e) {
            if (signal.aborted) throw e;
            result = `ERROR: invalid JSON arguments (${(e as Error).message})`;
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: result });
        }
      }
    }

    // ---------------------------------------------------------------- ReAct text protocol
    if (!native && !signal.aborted) {
      const reactSys = () => `${sysFor()}\n\n${reactProtocol(activeTools())}`;
      const msgs: ChatMessageInput[] = [{ role: "system", content: reactSys() }, ...ctxMsgs.filter((m) => m.role !== "system"), ];
      const extraSystem = ctxMsgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const setSys = () => (msgs[0] = { role: "system", content: extraSystem ? `${extraSystem}\n\n${reactSys()}` : reactSys() });
      setSys();
      for (;;) {
        if (signal.aborted) break;
        const limitHit = toolCalls >= MAX_AGENT_STEPS || remaining() < 45_000;
        if (limitHit) msgs.push({ role: "user", content: `Time/tool budget reached. Give the final answer now without any tool JSON.` });
        let text = "";
        try {
          setSys();
          setPhase(toolCalls === 0 ? "plan" : "thinking", toolCalls === 0 ? "يفهم الطلب ويخطط" : "يفكّر في الخطوة الجاية");
          text = await callModel(limitHit ? 40_000 : STEP_MS, async (sig) => {
            let t = "";
            for await (const ch of adapter.chat({ model: model.modelId, messages: msgs, maxTokens, signal: sig })) {
              if (ch.type === "text") t += ch.text;
              else if (ch.type === "reasoning") {
                reasoning += ch.text;
                emit({ type: "reasoning", text: ch.text });
              } else if (ch.type === "usage") usage = addUsage(usage, ch);
            }
            return t;
          });
        } catch (e) {
          if (signal.aborted || !toolCalls) throw e;
          finalText = timeoutAnswer(steps, (e as Error).message?.slice(0, 160));
          break;
        }
        const action = limitHit ? null : parseAction(text);
        if (!action) {
          finalText = text;
          break;
        }
        if (action.before) pushStep({ kind: "note", text: action.before.slice(0, 2000) });
        toolCalls++;
        const result = await execTool(action.tool, action.args);
        msgs.push({ role: "assistant", content: text });
        msgs.push({ role: "user", content: `TOOL_RESULT (${action.tool}):\n${result}\n\nContinue: call the next tool, or give the final answer if the task is done.` });
      }
    }
  } finally {
    await mcp.close();
    await persist();
  }

  // Never let the summary miss (or invent) the real link: append every URL publish_site actually returned.
  const published = [
    ...new Set(
      steps
        .filter((s) => s.kind === "tool" && s.name === "publish_site" && s.status === "ok")
        .map((s) => /"url"\s*:\s*"([^"]+)"/.exec(s.result ?? "")?.[1])
        .filter((u): u is string => Boolean(u)),
    ),
  ];
  const missing = published.filter((u) => !finalText.includes(u) && !finalText.includes(u.replace(/\/$/, "")));
  if (missing.length) finalText = `${finalText.trimEnd()}\n\n🔗 **الرابط المنشور:** ${missing.map((u) => `[${u}](${u})`).join(" · ")}`;

  setPhase("done", "خلص");
  // stream the final answer in small chunks so the UI renders progressively
  for (let i = 0; i < finalText.length; i += 400) emit({ type: "delta", text: finalText.slice(i, i + 400) });
  return { text: finalText, reasoning, usage, steps };
}
