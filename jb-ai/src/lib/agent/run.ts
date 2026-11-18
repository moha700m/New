import "server-only";
import type { AiModel, Provider } from "@prisma/client";
import { prisma } from "../db";
import { getAdapter, OpenAICompatibleAdapter, ProviderError, type ChatMessageInput } from "../providers";
import { toOpenAIMessages } from "../providers/openai-compatible";
import { BUILTIN_TOOLS, clip, loadMcpTools, type AgentTool } from "./tools";

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

function systemPrompt(tools: AgentTool[], mcpErrors: string[]) {
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
    mcpErrors.length ? `Note: some MCP servers failed to connect: ${mcpErrors.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Final answer when the model ran out of time: list what was done and any links produced. */
function timeoutAnswer(steps: AgentStep[]) {
  const done = steps.filter((s) => s.kind === "tool" && s.status === "ok");
  const links = [...new Set(done.flatMap((s) => (`${s.summary ?? ""} ${s.result ?? ""}`.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [])))].slice(0, 8);
  return [
    "⏱️ الوقت المسموح للمهمة خلص قبل ما يكمّل النموذج الرد الأخير.",
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
    opts.onProgress?.();
    emit({ type: "agent_step", step });
    return step;
  };
  const updateStep = (step: AgentStep, patch: Partial<AgentStep>) => {
    Object.assign(step, patch);
    emit({ type: "agent_step", step });
  };

  const mcp = await loadMcpTools(signal);
  const tools = [...BUILTIN_TOOLS, ...mcp.tools].slice(0, 120);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCtx = { userId: opts.userId, assistantMessageId: opts.assistantMessageId, emit, signal, workspace: new Map<string, string>() };
  if (mcp.errors.length) pushStep({ kind: "info", text: `تعذّر الاتصال ببعض خوادم MCP: ${mcp.errors.join(" · ")}` });

  async function execTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = byName.get(name);
    const step = pushStep({ kind: "tool", name, label: tool?.label ?? name, args: argsSummary(args), status: "running" });
    const t0 = Date.now();
    if (!tool) {
      updateStep(step, { status: "error", result: `Unknown tool "${name}"`, ms: 0 });
      void persist();
      return `ERROR: unknown tool "${name}". Available: ${tools.map((t) => t.name).join(", ")}`;
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

  const sys = systemPrompt(tools, mcp.errors);
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
      const spec = tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description.slice(0, 1000), parameters: t.parameters } }));
      for (let round = 0; ; round++) {
        if (signal.aborted) break;
        const limitHit = toolCalls >= MAX_AGENT_STEPS || remaining() < 45_000;
        if (limitHit) messages.push({ role: "user", content: `Time/tool budget reached. Stop calling tools and give the final answer now with what you have (include any links already produced).` });
        let r;
        try {
          r = await oa.completeWithTools({ model: model.modelId, messages, tools: limitHit ? undefined : spec, maxTokens, signal: callSignal(limitHit ? 40_000 : 180_000) });
        } catch (e) {
          if (round === 0 && e instanceof ProviderError && (e.status === 400 || e.status === 422) && !signal.aborted) {
            pushStep({ kind: "info", text: "النموذج رفض استدعاء الأدوات الأصلي، تحويل لبروتوكول ReAct النصي." });
            native = false;
            break;
          }
          if (!signal.aborted && round > 0) {
            finalText = timeoutAnswer(steps);
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
      const msgs: ChatMessageInput[] = [{ role: "system", content: `${sys}\n\n${reactProtocol(tools)}` }, ...ctxMsgs.filter((m) => m.role !== "system"), ];
      const extraSystem = ctxMsgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      if (extraSystem) msgs[0] = { role: "system", content: `${extraSystem}\n\n${msgs[0]!.content}` };
      for (;;) {
        if (signal.aborted) break;
        const limitHit = toolCalls >= MAX_AGENT_STEPS || remaining() < 45_000;
        if (limitHit) msgs.push({ role: "user", content: `Time/tool budget reached. Give the final answer now without any tool JSON.` });
        let text = "";
        try {
          for await (const ch of adapter.chat({ model: model.modelId, messages: msgs, maxTokens, signal: callSignal(limitHit ? 40_000 : 180_000) })) {
            if (ch.type === "text") text += ch.text;
            else if (ch.type === "reasoning") {
              reasoning += ch.text;
              emit({ type: "reasoning", text: ch.text });
            } else if (ch.type === "usage") usage = addUsage(usage, ch);
          }
        } catch (e) {
          if (signal.aborted || !toolCalls) throw e;
          finalText = timeoutAnswer(steps);
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
