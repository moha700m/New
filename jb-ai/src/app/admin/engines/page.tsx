"use client";
import { Play, RefreshCw, Wand2, Wifi } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, fmtDate, fmtNum, fmtUsd } from "@/components/api";
import { HealthBadge, PageHeader, Stat, useAction, useAdmin } from "@/components/admin/ui";
import type { ProviderRow } from "@/components/admin/types";

interface Overview { engine: { configVersion: number; activeProvider: string | null; effectiveDefaultModel: { id: string; name: string; provider: string } | null; fallbackEnabled: boolean; fallbackModel: { name: string; provider: string } | null; fallbackProvider: string | null } }
interface Usage { totals: { requests: number; tokens: number; costUsd: number | null }; byProvider: { provider: string; requests: number; tokens: number; costUsd: number | null; avgLatencyMs: number | null }[]; errors: { id: string; createdAt: string; modelKey: string; errorMessage: string | null; provider: { name: string } | null }[] }

export default function EnginesPage() {
  const ov = useAdmin<Overview>("/api/admin/overview");
  const pr = useAdmin<{ providers: ProviderRow[] }>("/api/admin/providers");
  const us = useAdmin<Usage>("/api/admin/usage?days=7");
  const { run, busy } = useAction();
  const [modelTest, setModelTest] = useState<{ ok: boolean; latencyMs: number; firstTokenMs: number | null; output: string; error: string | null } | null>(null);
  const reloadAll = () => { void ov.reload(); void pr.reload(); void us.reload(); };
  const e = ov.data?.engine;

  return (
    <>
      <PageHeader title="AI Engines" subtitle="Live status of the inference engines serving customers." actions={<button className="btn-outline" onClick={reloadAll}><RefreshCw size={15} /> Refresh</button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active provider" value={e?.activeProvider ?? "—"} />
        <Stat label="Active model" value={<span className="text-lg">{e?.effectiveDefaultModel?.name ?? "none"}</span>} hint={e?.effectiveDefaultModel?.provider} tone={e?.effectiveDefaultModel ? undefined : "err"} />
        <Stat label="Requests (7d)" value={fmtNum(us.data?.totals.requests)} hint={`${fmtNum(us.data?.totals.tokens)} tokens`} />
        <Stat label="Est. API cost (7d)" value={fmtUsd(us.data?.totals.costUsd)} hint={`Errors: ${us.data?.errors.length ?? 0}`} tone={us.data?.errors.length ? "warn" : undefined} />
      </div>

      <div className="card mt-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 text-sm">
          <b>Default model test</b> — sends a real prompt to <span className="text-brand-400">{e?.effectiveDefaultModel?.name ?? "—"}</span>.
          <span className="ml-2 text-slate-400">Fallback: {e?.fallbackEnabled ? (e.fallbackModel ? `${e.fallbackModel.name} (${e.fallbackModel.provider})` : e.fallbackProvider ?? "no target set") : "disabled"}</span>
        </div>
        <button className="btn-primary" disabled={!e?.effectiveDefaultModel || busy === "mt"} onClick={async () => { const r = await run("mt", () => api<{ result: typeof modelTest }>(`/api/admin/models/${e!.effectiveDefaultModel!.id}/test`, { method: "POST" })); if (r) setModelTest(r.result); }}>
          <Play size={15} /> {busy === "mt" ? "Testing…" : "Test model"}
        </button>
        {modelTest && (
          <div className={`w-full rounded-lg border px-3 py-2 text-sm ${modelTest.ok ? "border-emerald-500/30 bg-emerald-950/30" : "border-red-500/30 bg-red-950/30"}`}>
            {modelTest.ok ? <>✅ {modelTest.latencyMs} ms (first token {modelTest.firstTokenMs ?? "—"} ms): <i>{modelTest.output}</i></> : <>❌ {modelTest.error}</>}
          </div>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Engines by provider</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {pr.data?.providers.map((p) => {
          const u = us.data?.byProvider.find((x) => x.provider === p.name);
          return (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{p.name} {!p.enabled && <span className="text-xs font-normal text-slate-500">(disabled)</span>}</h3>
                  <p className="text-xs text-slate-500">{p.type} · {p.baseUrl}</p>
                </div>
                <HealthBadge status={p.healthStatus} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-slate-400">Available models</dt><dd>{p.modelCount}</dd>
                <dt className="text-slate-400">Enabled / disabled</dt><dd>{p.enabledModelCount} / {p.modelCount - p.enabledModelCount}</dd>
                <dt className="text-slate-400">Catalog sync</dt><dd>{p.lastSyncAt ? `${p.lastSyncStatus} · ${fmtDate(p.lastSyncAt, true)}` : "never"}</dd>
                <dt className="text-slate-400">Requests (7d)</dt><dd>{fmtNum(u?.requests ?? 0)} · {fmtNum(u?.tokens ?? 0)} tok</dd>
                <dt className="text-slate-400">Avg latency</dt><dd>{u?.avgLatencyMs ? `${u.avgLatencyMs} ms` : "—"}</dd>
                <dt className="text-slate-400">Est. cost (7d)</dt><dd>{fmtUsd(u?.costUsd ?? null)}</dd>
              </dl>
              {p.lastHealthError && <p className="mt-2 text-xs text-amber-300">{p.lastHealthError}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `t${p.id}`} onClick={() => run(`t${p.id}`, () => api<{ result: { ok: boolean; detail: string } }>(`/api/admin/providers/${p.id}/test`, { method: "POST" }), (r) => (r.result.ok ? "✅ " : "⚠️ ") + r.result.detail).then(reloadAll)}><Wifi size={14} /> Test connection</button>
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `s${p.id}`} onClick={() => run(`s${p.id}`, () => api<{ result: { discovered: number; created: number } }>(`/api/admin/providers/${p.id}/sync`, { method: "POST" }), (r) => `Discovered ${r.result.discovered} (${r.result.created} new)`).then(reloadAll)}><RefreshCw size={14} /> {busy === `s${p.id}` ? "Syncing…" : "Sync catalog"}</button>
                {p.type === "VENICE" && <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`sg${p.id}`, () => api<{ result: { applied: Record<string, string> } }>(`/api/admin/providers/${p.id}/suggested`, { method: "POST" }), (r) => `Applied Venice defaults: ${Object.entries(r.result.applied).map(([k, v]) => `${k}=${v}`).join(", ")}`).then(reloadAll)}><Wand2 size={14} /> Apply Venice suggested defaults</button>}
                <Link href={`/admin/models?providerId=${p.id}`} className="btn-ghost px-2.5 py-1.5">Models →</Link>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent request errors</h2>
      <div className="card p-0">
        {!us.data?.errors.length ? <p className="p-4 text-sm text-slate-400">No errors in the last 7 days.</p> : (
          <ul className="divide-y divide-ink-700 text-sm">
            {us.data.errors.slice(0, 15).map((er) => (
              <li key={er.id} className="px-4 py-2.5"><span className="text-slate-500">{fmtDate(er.createdAt, true)}</span> · <b>{er.provider?.name}</b> / {er.modelKey}<div className="text-xs text-red-300">{er.errorMessage}</div></li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
