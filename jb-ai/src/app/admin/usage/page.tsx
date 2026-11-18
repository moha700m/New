"use client";
import { useState } from "react";
import { fmtDate, fmtNum, fmtUsd } from "@/components/api";
import { PageHeader, Stat, Table, useAdmin } from "@/components/admin/ui";

interface Usage {
  totals: { requests: number; tokens: number; costUsd: number | null };
  costSources: { source: string; requests: number; costUsd: number | null }[];
  daily: { day: string; requests: number; errors: number; tokens: number; cost: number | null }[];
  byModel: { modelKey: string; requests: number; tokens: number; promptTokens: number; completionTokens: number; costUsd: number | null }[];
  byProvider: { provider: string; requests: number; tokens: number; costUsd: number | null; avgLatencyMs: number | null }[];
  errors: { id: string; createdAt: string; modelKey: string; errorMessage: string | null; kind: string; usedFallback: boolean; provider: { name: string } | null; user: { email: string } | null }[];
}

export default function UsagePage() {
  const [days, setDays] = useState(14);
  const { data } = useAdmin<Usage>(`/api/admin/usage?days=${days}`);
  const max = Math.max(1, ...(data?.daily.map((d) => d.requests) ?? [1]));
  return (
    <>
      <PageHeader
        title="API Usage"
        subtitle="Token counts are provider-reported. Cost is provider-reported when available, otherwise estimated from the model's catalog pricing (never invented)."
        actions={<select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requests" value={fmtNum(data?.totals.requests)} />
        <Stat label="Tokens" value={fmtNum(data?.totals.tokens)} />
        <Stat label="Cost" value={fmtUsd(data?.totals.costUsd)} />
        <Stat label="Cost sources" value={<span className="text-sm">{data?.costSources.map((c) => `${c.source}: ${c.requests}`).join(" · ") || "—"}</span>} />
      </div>
      <div className="card mt-4">
        <h2 className="mb-3 font-semibold">Requests per day</h2>
        {!data?.daily.length ? <p className="text-sm text-slate-400">No usage yet.</p> : (
          <div className="flex h-40 items-end gap-1">
            {data.daily.map((d) => (
              <div key={d.day} className="group relative flex flex-1 flex-col justify-end" title={`${fmtDate(d.day)}: ${d.requests} requests, ${d.errors} errors, ${fmtNum(d.tokens)} tokens`}>
                <div className="rounded-t bg-brand-500/80" style={{ height: `${((d.requests - d.errors) / max) * 100}%` }} />
                <div className="bg-red-400/80" style={{ height: `${(d.errors / max) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">By provider</h2>
          <Table head={["Provider", "Requests", "Tokens", "Cost", "Avg latency"]} empty={!data?.byProvider.length}>
            {data?.byProvider.map((p) => <tr key={p.provider}><td className="px-3 py-2">{p.provider}</td><td className="px-3 py-2">{fmtNum(p.requests)}</td><td className="px-3 py-2">{fmtNum(p.tokens)}</td><td className="px-3 py-2">{fmtUsd(p.costUsd)}</td><td className="px-3 py-2">{p.avgLatencyMs ?? "—"} ms</td></tr>)}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">By model</h2>
          <Table head={["Model", "Requests", "In / out tokens", "Cost"]} empty={!data?.byModel.length}>
            {data?.byModel.map((m) => <tr key={m.modelKey}><td className="px-3 py-2 font-mono text-xs">{m.modelKey}</td><td className="px-3 py-2">{fmtNum(m.requests)}</td><td className="px-3 py-2">{fmtNum(m.promptTokens)} / {fmtNum(m.completionTokens)}</td><td className="px-3 py-2">{fmtUsd(m.costUsd)}</td></tr>)}
          </Table>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Errors</h2>
      <Table head={["Time", "User", "Provider / model", "Error"]} empty={!data?.errors.length}>
        {data?.errors.map((e) => <tr key={e.id} className="align-top"><td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(e.createdAt, true)}</td><td className="px-3 py-2 text-xs">{e.user?.email}</td><td className="px-3 py-2 text-xs">{e.provider?.name} / {e.modelKey}{e.usedFallback && " (fallback)"}</td><td className="px-3 py-2 text-xs text-red-300">{e.errorMessage}</td></tr>)}
      </Table>
    </>
  );
}
