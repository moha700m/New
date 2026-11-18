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
    "Never invent tool results. Prefer reading before writing (e.g. read a repo file before editing it). For GitHub work use the GitHub MCP tools when available: inspect the repo, create a branch, commit files, open a pull request, and report links.",
    "When finished, reply with a clear final answer in the user's language (Saudi/Gulf Arabic if the user writes Arabic) summarizing what you did, with links/sources.",
    `Available tools: ${tools.map((t) => t.name).join(", ") || "(none)"}.`,
    mcpErrors.length ? `Note: some MCP servers failed to connect: ${mcpErrors.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  const toolCtx = { userId: opts.userId, assistantMessageId: opts.assistantMessageId, emit, signal };
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
      const out = await tool.run(args, toolCtx);
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
  const maxTokens = model.maxOutputTokens ? Math.min(model.maxOutputTokens, 8192) : 4096;
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
        const limitHit = toolCalls >= MAX_AGENT_STEPS;
        if (limitHit) messages.push({ role: "user", content: `You reached the limit of ${MAX_AGENT_STEPS} tool calls. Stop calling tools and give the final answer now with what you have.` });
        let r;
        try {
          r = await oa.completeWithTools({ model: model.modelId, messages, tools: limitHit ? undefined : spec, maxTokens, signal });
        } catch (e) {
          if (round === 0 && e instanceof ProviderError && (e.status === 400 || e.status === 422) && !signal.aborted) {
            pushStep({ kind: "info", text: "النموذج رفض استدعاء الأدوات الأصلي، تحويل لبروتوكول ReAct النصي." });
            native = false;
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
        const limitHit = toolCalls >= MAX_AGENT_STEPS;
        if (limitHit) msgs.push({ role: "user", content: `Tool-call limit (${MAX_AGENT_STEPS}) reached. Give the final answer now without any tool JSON.` });
        let text = "";
        for await (const ch of adapter.chat({ model: model.modelId, messages: msgs, maxTokens, signal })) {
          if (ch.type === "text") text += ch.text;
          else if (ch.type === "reasoning") {
            reasoning += ch.text;
            emit({ type: "reasoning", text: ch.text });
          } else if (ch.type === "usage") usage = addUsage(usage, ch);
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
