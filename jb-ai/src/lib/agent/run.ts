import "server-only";
import type { AiModel, Provider } from "@prisma/client";
import { prisma } from "../db";
import { getAdapter, OpenAICompatibleAdapter, ProviderError, type ChatMessageInput } from "../providers";
import { toOpenAIMessages } from "../providers/openai-compatible";
import { BUILTIN_TOOLS, clip, loadMcpTools, type AgentTool, type ToolGroup } from "./tools";

export const MAX_AGENT_STEPS = 25;

export interface AgentStep {
  id: string;
  kind: "tool" | "note" | "info";
  name?: string;
  label?: string;
  args?: string;
  status?: "running" | "ok" | "error";
  summary?: string;
  result?: string;
  ms?: number;
  text?: string;
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
    `You are JB AI Agent — an autonomous assistant that completes tasks end-to-end using tools (like Claude Code). Today is ${now}.`,
    `Work in steps: think briefly, call tools, read their results, fix errors and retry with different inputs, and continue until the task is fully done. You may use up to ${MAX_AGENT_STEPS} tool calls.`,
    "Never invent tool results. Prefer reading before writing (e.g. read a repo file before editing it).",
    "You are also a senior full-stack web engineer and product designer. When asked to build a site/app:",
    "1) PLAN briefly (pages, sections, content, colors) — fill missing details with smart defaults instead of asking; use the user's real details (names, prices, phone numbers) exactly.",
    "2) BUILD complete, production-quality files — never placeholders like 'lorem ipsum' or 'add content here'. Defaults: semantic HTML5, mobile-first responsive CSS (flex/grid, clamp() type scale), Arabic content → <html lang=\"ar\" dir=\"rtl\"> with IBM Plex Sans Arabic from Google Fonts, accessible contrast, 44px tap targets, smooth subtle animations, meta viewport + description + Open Graph tags, favicon (inline SVG emoji is fine), fast (no heavy frameworks for static sites; Tailwind CDN allowed). WhatsApp links: https://wa.me/<digits>. Images: generated ones (attachment_id), https://images.unsplash.com/… photos, or CSS/SVG art.",
    "   Use write_files to put the project into the workspace (split big projects across calls: index.html, styles.css, app.js…).",
    "3) SHIP — pick the best available route and do it yourself:",
    "   • Instant public link (always available): publish_site (no args = whole workspace).",
    "   • GitHub (if github__* tools exist): github__create_repo (public) → github__push_files (no files = whole workspace) → github__enable_pages → live at https://<owner>.github.io/<repo>/. Vercel/Netlify/Cloudflare one-tap: github__deploy_links and give those links (the user taps once, signs in, and the repo deploys; future pushes redeploy automatically).",
    "   • Cloudflare / Netlify / Supabase / Neon / Railway connector tools (names start with the connector) — use them directly when the user asks for that platform (e.g. Cloudflare tools can create Workers/Pages; Netlify tools can create sites and deploy).",
    "4) VERIFY with check_url on every live URL (GitHub Pages can take ~1 minute: retry), fix and redeploy if broken.",
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
  const active = new Set<string>([...BUILTIN_TOOLS.map((t) => t.name)]);
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
  const allTools = [...BUILTIN_TOOLS, ...mcp.tools, ...(groups.some((g) => !g.core) ? [useConnector] : [])];
  if (allTools.includes(useConnector)) active.add(useConnector.name);
  const byName = new Map(allTools.map((t) => [t.name, t]));
  const activeTools = () => allTools.filter((t) => active.has(t.name));
  const tools = allTools;
  const toolCtx = { userId: opts.userId, assistantMessageId: opts.assistantMessageId, emit, signal, workspace: new Map<string, string>() };
  if (mcp.reconnect.length) pushStep({ kind: "info", text: `${mcp.reconnect.join(" و")}: الربط انتهى — اضغط «ربط» مرة ثانية من الموصّلات. كمّلت بدونه.` });

  async function execTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = byName.get(name);
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
  const sysFor = () => systemPrompt(activeTools(), mcp.errors, lazyGroups());
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
          r = await callModel(limitHit ? 40_000 : STEP_MS, (sig) => oa.completeWithTools({ model: model.modelId, messages, tools: spec, maxTokens, signal: sig }));
        } catch (e) {
          if (round === 0 && e instanceof ProviderError && (e.status === 400 || e.status === 422) && !signal.aborted) {
            pushStep({ kind: "info", text: "النموذج رفض استدعاء الأدوات الأصلي، تحويل لبروتوكول ReAct النصي." });
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

  // stream the final answer in small chunks so the UI renders progressively
  for (let i = 0; i < finalText.length; i += 400) emit({ type: "delta", text: finalText.slice(i, i + 400) });
  return { text: finalText, reasoning, usage, steps };
}
