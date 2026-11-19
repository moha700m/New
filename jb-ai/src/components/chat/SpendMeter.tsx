"use client";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

type Spend = {
  available: boolean; balanceUsd: number | null; spentTodayUsd: number; spent7dUsd: number; spent30dUsd: number; creditsAdded30dUsd: number;
  requestsToday: number; avgPerMessageUsd: number | null; remainingMessages: number | null; lastMessageUsd: number | null; error?: string;
};

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? "—" : `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(digits)}`);

/** Owner-only: Venice balance in the header; tap for today's spend, average per message and how many messages are left. */
export function SpendMeter({ refreshKey }: { refreshKey: number }) {
  const [d, setD] = useState<Spend | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setD(await api<Spend>(`/api/account/spend${force ? "?refresh=1" : ""}`));
    } catch {
      /* not owner */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(refreshKey > 0);
  }, [load, refreshKey]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!d) return null;
  const low = d.balanceUsd != null && d.balanceUsd < 1;
  const pct = d.balanceUsd != null && d.creditsAdded30dUsd > 0 ? Math.max(0, Math.min(100, (d.balanceUsd / Math.max(d.creditsAdded30dUsd, d.balanceUsd)) * 100)) : null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold tabular-nums ${low ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-ink-600 bg-ink-850 text-slate-100"}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="spend-meter"
        aria-label="الرصيد والصرف"
      >
        <Wallet size={15} className={low ? "text-rose-300" : "text-emerald-400"} />
        <span dir="ltr">{d.available ? usd(d.balanceUsd) : "—"}</span>
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-40 rounded-2xl border border-ink-600 bg-ink-900 p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-80" data-testid="spend-panel">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">رصيد Venice</span>
            <button className="btn-ghost p-1.5 text-slate-400" onClick={() => load(true)} aria-label="تحديث">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          {d.error && !d.available ? (
            <p className="mt-3 text-sm text-rose-300">{d.error}</p>
          ) : (
            <>
              <div className="mt-2 flex items-end gap-2">
                <span dir="ltr" className={`text-3xl font-bold tabular-nums ${low ? "text-rose-300" : ""}`}>{usd(d.balanceUsd)}</span>
                <span className="pb-1 text-xs text-slate-400">باقي لك</span>
              </div>
              {pct != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div className={`h-full rounded-full ${low ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <Stat label="صرفت اليوم" value={usd(d.spentTodayUsd, 3)} sub={`${d.requestsToday} طلب`} />
                <Stat label="آخر ٧ أيام" value={usd(d.spent7dUsd)} />
                <Stat label="متوسط الرسالة" value={usd(d.avgPerMessageUsd, 4)} />
                <Stat label="آخر رسالة" value={usd(d.lastMessageUsd, 4)} />
              </div>
              <div className="mt-3 rounded-xl bg-ink-850 p-3 text-center text-sm">
                {d.remainingMessages != null ? (
                  <>
                    يكفيك تقريباً <b className="text-lg tabular-nums text-emerald-300">{d.remainingMessages.toLocaleString("en")}</b> رسالة
                    <div className="mt-0.5 text-[11px] text-slate-500">حسب متوسط آخر ١٠٠ طلب — النماذج الكبيرة والصور أغلى، و«المجانية» ما تخصم شي</div>
                  </>
                ) : (
                  "ما فيه صرف كافٍ لحساب المتوسط بعد"
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-ink-850 px-2 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div dir="ltr" className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
