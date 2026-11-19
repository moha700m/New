"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../ui/Toast";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "err" }) {
  const color = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "err" ? "text-red-300" : "text-white";
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function HealthBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    HEALTHY: "bg-emerald-500/15 text-emerald-300",
    DEGRADED: "bg-amber-500/15 text-amber-300",
    DOWN: "bg-red-500/15 text-red-300",
    UNKNOWN: "bg-slate-500/15 text-slate-300",
  };
  const label: Record<string, string> = { HEALTHY: "سليم", DEGRADED: "متعثّر", DOWN: "متوقف", UNKNOWN: "غير معروف" };
  return <span className={`badge ${map[status] ?? map.UNKNOWN}`}>● {label[status] ?? status}</span>;
}

export function OnOff({ on, onLabel = "مفعّل", offLabel = "معطّل" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <span className={`badge ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}`}>{on ? onLabel : offLabel}</span>;
}

/** Fetch an admin resource with reload + toast-on-error. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }, [path, toast]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Run a mutation with toast feedback. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, okMsg?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg, "ok");
        return r;
      } catch (e) {
        toast((e as Error).message, "err");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { run, busy };
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-600">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-ink-850 text-start text-xs text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-700">{children}</tbody>
      </table>
      {empty && <p className="p-6 text-center text-sm text-slate-500">لا يوجد شيء هنا بعد.</p>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
