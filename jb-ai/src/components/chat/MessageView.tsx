"use client";
import { AgentSteps, type UiAgentStep } from "./AgentSteps";
import { AlertTriangle, Brain, Check, ChevronDown, Copy, FileText, Pencil, RefreshCw, Shuffle } from "lucide-react";
import { useState } from "react";
import { Markdown } from "./Markdown";
import { LiveStatus, type UiLive } from "./LiveStatus";
import { withMentionChips } from "./Mentions";

export interface UiAttachment {
  id: string;
  filename: string;
  mimeType: string;
  kind: string;
  previewUrl?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  status: "complete" | "streaming" | "stopped" | "error";
  error?: string | null;
  modelName?: string | null;
  providerName?: string | null;
  usedFallback?: boolean;
  notice?: string | null;
  attachments?: UiAttachment[];
  agentSteps?: UiAgentStep[] | null;
  costUsd?: number | null;
  live?: UiLive | null;
  agent?: boolean;
}

function Attachments({ list }: { list: UiAttachment[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {list.map((a) =>
        a.kind === "generated-image" ? (
          <figure key={a.id} className="w-full max-w-[520px]">
            <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
              <img src={a.previewUrl ?? `/api/attachments/${a.id}`} alt={a.filename} className="h-auto w-full rounded-xl border border-ink-600" loading="lazy" />
            </a>
            <figcaption className="mt-1.5 flex gap-2 text-xs">
              <a href={`/api/attachments/${a.id}?download=1`} download={a.filename} className="btn-outline px-2.5 py-1">
                تحميل الصورة
              </a>
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="btn-ghost px-2.5 py-1 text-slate-400">
                فتح بالحجم الكامل
              </a>
            </figcaption>
          </figure>
        ) : a.kind === "image" ? (
          <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
            <img src={a.previewUrl ?? `/api/attachments/${a.id}`} alt={a.filename} className="h-28 w-28 rounded-xl border border-ink-600 object-cover" />
          </a>
        ) : (
          <a key={a.id} href={`/api/attachments/${a.id}`} className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs hover:bg-ink-700">
            <FileText size={15} className="text-slate-400" /> {a.filename}
          </a>
        ),
      )}
    </div>
  );
}

export function MessageView({ m, isLast, canAct, onRegenerate, onEdit }: { m: UiMessage; isLast: boolean; canAct: boolean; onRegenerate: () => void; onEdit: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [showReasoning, setShowReasoning] = useState(false);

  if (m.role === "user") {
    return (
      <div className="group flex flex-col items-end" data-testid="msg-user">
        {m.attachments?.length ? <Attachments list={m.attachments} /> : null}
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-ink-500 bg-ink-800 p-3">
            <textarea dir="auto" className="input min-h-[90px] resize-y border-none bg-transparent p-0 focus:ring-0" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                إلغاء
              </button>
              <button
                className="btn-primary"
                disabled={!draft.trim()}
                onClick={() => {
                  setEditing(false);
                  onEdit(draft.trim());
                }}
              >
                حفظ وإرسال
              </button>
            </div>
          </div>
        ) : (
          m.content && <div dir="auto" className="msg-text max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-ink-700 px-4 py-2.5 text-[15px] leading-7">{withMentionChips(m.content)}</div>
        )}
        {!editing && canAct && (
          <div className="mt-1 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            <button className="btn-ghost p-1.5" onClick={() => { setDraft(m.content); setEditing(true); }} aria-label="تعديل الرسالة" title="تعديل">
              <Pencil size={14} />
            </button>
            <button className="btn-ghost p-1.5" onClick={() => navigator.clipboard.writeText(m.content)} aria-label="نسخ الرسالة" title="نسخ">
              <Copy size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  const streaming = m.status === "streaming";
  return (
    <div className="group" data-testid="msg-assistant">
      {(m.notice || m.usedFallback) && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-300/90">
          <Shuffle size={13} /> {m.notice || `ردّ النموذج الاحتياطي ${m.modelName ?? ""}`}
        </div>
      )}
      {m.reasoning && (
        <div className="mb-3">
          <button className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200" onClick={() => setShowReasoning((s) => !s)}>
            <Brain size={14} /> {streaming && !m.content ? "يفكّر…" : "خطوات التفكير"}
            <ChevronDown size={14} className={`transition ${showReasoning ? "rotate-180" : ""}`} />
          </button>
          {(showReasoning || (streaming && !m.content)) && (
            <div dir="auto" className={`mt-2 overflow-y-auto whitespace-pre-wrap border-s-2 border-ink-500 ps-3 text-sm leading-6 text-slate-400 ${showReasoning ? "max-h-72" : "max-h-24"}`}>
              {/* while it is thinking, show only the latest lines so the live status and steps stay in view */}
              {showReasoning ? m.reasoning : m.reasoning.length > 420 ? "…" + m.reasoning.slice(-420) : m.reasoning}
            </div>
          )}
        </div>
      )}
      {m.agentSteps?.length ? <AgentSteps steps={m.agentSteps} running={streaming && !m.content} /> : null}
      {m.attachments?.length ? <Attachments list={m.attachments} /> : null}
      {m.content ? (
        <div dir="auto" className={streaming ? "typing-cursor" : ""}>
          <Markdown text={m.content} />
        </div>
      ) : streaming && !m.reasoning && !m.agentSteps?.length && !m.live ? (
        <div className="flex h-7 items-center gap-1" aria-label="يجهّز…">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      ) : null}
      {streaming && m.live && (
        <div className="sticky bottom-2 z-10 mt-2">
          <LiveStatus live={m.live} agent={Boolean(m.agent || m.agentSteps?.length)} />
        </div>
      )}
      {m.status === "error" && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200" data-testid="msg-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {m.error || "صار خطأ غير متوقع."}
        </div>
      )}
      {m.status === "stopped" && <div className="mt-1 text-xs text-slate-500">تم إيقاف الرد.</div>}
      {!streaming && (
        <div className="mt-2 flex items-center gap-1 text-slate-500">
          {m.content && (
            <button
              className="btn-ghost p-1.5"
              onClick={() => {
                void navigator.clipboard.writeText(m.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              aria-label="نسخ الرد"
              title="نسخ"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          )}
          {isLast && canAct && (
            <button className="btn-ghost p-1.5" onClick={onRegenerate} aria-label="إعادة توليد الرد" title="عيد التوليد" data-testid="regenerate">
              <RefreshCw size={15} />
            </button>
          )}
          {m.modelName && <span className="ms-1 text-xs"><bdi>{m.modelName}</bdi></span>}
          {m.costUsd != null && m.costUsd > 0 && (
            <span dir="ltr" className="text-xs tabular-nums text-slate-600" title="تكلفة هذا الرد التقريبية">
              · ${m.costUsd < 0.001 ? m.costUsd.toFixed(5) : m.costUsd.toFixed(4)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
