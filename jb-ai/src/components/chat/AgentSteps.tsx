"use client";
import { AlertTriangle, Bot, Check, ChevronDown, Circle, CircleDot, Info, Loader2, Wrench } from "lucide-react";
import { useState } from "react";

export interface UiAgentStep {
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

function PlanList({ items }: { items: NonNullable<UiAgentStep["items"]> }) {
  const done = items.filter((x) => x.status === "done").length;
  return (
    <li className="rounded-lg border border-ink-600 bg-ink-850/70 px-2.5 py-2" data-testid="agent-plan">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
        <span>الخطة</span>
        <span className="tabular-nums text-slate-500">{done}/{items.length}</span>
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className={`flex items-start gap-2 text-xs ${it.status === "done" ? "text-slate-500 line-through decoration-slate-600" : it.status === "in_progress" ? "text-sky-100" : "text-slate-400"}`}>
            {it.status === "done" ? <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : it.status === "in_progress" ? <CircleDot size={13} className="mt-0.5 shrink-0 animate-pulse text-sky-300" /> : <Circle size={13} className="mt-0.5 shrink-0 text-slate-600" />}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ToolStep({ s }: { s: UiAgentStep }) {
  const [open, setOpen] = useState(false);
  const icon = s.status === "running" ? <Loader2 size={14} className="animate-spin text-sky-300" /> : s.status === "error" ? <AlertTriangle size={14} className="text-amber-300" /> : <Check size={14} className="text-emerald-300" />;
  return (
    <li className="rounded-lg border border-ink-600 bg-ink-850/70" data-testid="agent-step">
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-start text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon}
        <Wrench size={13} className="shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-slate-200">{s.label ?? s.name}</span>
          {s.args && <span dir="ltr" className="ms-2 font-mono text-[11px] text-slate-500">{s.args.length > 90 ? s.args.slice(0, 90) + "…" : s.args}</span>}
        </span>
        {s.summary && <span className="hidden shrink-0 text-[11px] text-slate-500 sm:inline">{s.summary}</span>}
        {s.ms != null && <span className="shrink-0 text-[11px] text-slate-600">{(s.ms / 1000).toFixed(1)}ث</span>}
        <ChevronDown size={13} className={`shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-ink-700 px-2.5 py-2 text-[11px]">
          <div><span className="text-slate-500">الأداة: </span><span dir="ltr" className="font-mono text-slate-300">{s.name}</span></div>
          {s.args && <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-ink-900 p-2 text-start font-mono text-slate-300">{s.args}</pre>}
          {s.result && <pre dir="auto" className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-ink-900 p-2 font-mono ${s.status === "error" ? "text-amber-200" : "text-slate-300"}`}>{s.result}</pre>}
        </div>
      )}
    </li>
  );
}

export function AgentSteps({ steps, running }: { steps: UiAgentStep[]; running: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const tools = steps.filter((s) => s.kind === "tool").length;
  return (
    <div className="mb-3" data-testid="agent-steps">
      <button className="flex items-center gap-1.5 text-xs font-medium text-sky-300/90 hover:text-sky-200" onClick={() => setCollapsed((c) => !c)}>
        <Bot size={14} /> {running ? "الوكيل يشتغل" : "خطوات الوكيل"} · {tools} {tools === 1 ? "خطوة" : "خطوات"}
        <ChevronDown size={14} className={`transition ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed && (
        <ol className="mt-2 space-y-1.5">
          {steps.map((s) =>
            s.kind === "tool" ? (
              <ToolStep key={s.id} s={s} />
            ) : s.kind === "plan" && s.items?.length ? (
              <PlanList key={s.id} items={s.items} />
            ) : (
              <li key={s.id} dir="auto" className={`flex items-start gap-1.5 px-1 text-xs ${s.kind === "info" ? "text-amber-300/90" : "text-slate-400"}`}>
                {s.kind === "info" ? <Info size={13} className="mt-0.5 shrink-0" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />}
                <span className="whitespace-pre-wrap">{s.text}</span>
              </li>
            ),
          )}

        </ol>
      )}
    </div>
  );
}
