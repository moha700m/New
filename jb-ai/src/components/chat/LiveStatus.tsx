"use client";
import { CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface UiLive {
  phase?: string | null;
  label?: string | null;
  detail?: string | null;
  startedAt: number;
  lastEventAt: number;
  reconnecting?: boolean;
}

const PHASE_STEPS = [
  { key: "plan", label: "يخطط" },
  { key: "build", label: "يكتب" },
  { key: "deploy", label: "ينشر" },
  { key: "verify", label: "يتحقق" },
];
const ORDER: Record<string, number> = { start: 0, plan: 0, research: 0, design: 1, build: 1, tools: 1, thinking: -1, deploy: 2, verify: 3, report: 4, done: 4 };

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Sticky "what is happening right now" bar: phase, elapsed time, heartbeat and reconnect state. */
export function LiveStatus({ live, agent }: { live: UiLive; agent: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [maxIdx, setMaxIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const idx = ORDER[live.phase ?? ""] ?? -1;
  useEffect(() => {
    if (idx > maxIdx) setMaxIdx(idx);
  }, [idx, maxIdx]);
  const quiet = now - live.lastEventAt > 10_000;
  const label = live.reconnecting
    ? "انقطع الاتصال — يعيد الاتصال، والشغل مكمّل في الخادم…"
    : quiet
      ? `${live.label ?? "يشتغل"} — لسا يشتغل…`
      : live.label ?? (agent ? "يبدأ…" : "يكتب الرد…");
  return (
    <div className="rounded-xl border border-sky-500/25 bg-ink-900/95 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur" data-testid="live-status" aria-live="polite">
      <div className="flex items-center gap-2 text-[13px]">
        {live.reconnecting ? <CloudOff size={14} className="shrink-0 text-amber-300" /> : <Loader2 size={14} className="shrink-0 animate-spin text-sky-300" />}
        <span className={`min-w-0 flex-1 truncate font-medium ${live.reconnecting ? "text-amber-200" : "text-sky-100"}`}>{label}</span>
        {live.detail && !live.reconnecting && <span dir="ltr" className="shrink-0 text-[11px] tabular-nums text-slate-400">{live.detail}</span>}
        <span dir="ltr" className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400" data-testid="live-timer">{fmt(now - live.startedAt)}</span>
      </div>
      {agent && (
        <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
          {PHASE_STEPS.map((p, i) => {
            const state = i < maxIdx || (i === maxIdx && live.phase === "done") ? "done" : i === Math.max(maxIdx, 0) ? "active" : "todo";
            return (
              <div key={p.key} className="flex flex-col gap-1">
                <div className={`h-1 rounded-full ${state === "done" ? "bg-emerald-400/80" : state === "active" ? "animate-pulse bg-sky-400" : "bg-ink-600"}`} />
                <span className={`text-center text-[10px] ${state === "todo" ? "text-slate-600" : state === "active" ? "text-sky-200" : "text-emerald-300/90"}`}>{p.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
