"use client";
import Link from "next/link";
import { fmtNum, fmtUsd, money } from "@/components/api";
import { HealthBadge, PageHeader, Stat, useAdmin } from "@/components/admin/ui";

interface Overview {
  stats: Record<string, number | null>;
  engine: { configVersion: number; activeProvider: string | null; defaultModel: { name: string; provider: string } | null; effectiveDefaultModel: { name: string; provider: string } | null; fallbackEnabled: boolean; fallbackProvider: string | null; fallbackModel: { name: string; provider: string } | null };
  providers: { id: string; name: string; type: string; enabled: boolean; healthStatus: string; lastHealthError: string | null; hasApiKey: boolean; lastSyncAt: string | null }[];
}

export default function AdminOverview() {
  const { data } = useAdmin<Overview>("/api/admin/overview");
  if (!data) return <p className="text-slate-400">Loading…</p>;
  const s = data.stats;
  const e = data.engine;
  return (
    <>
      <PageHeader title="Overview" subtitle={`Live configuration version ${e.configVersion}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={fmtNum(s.users)} hint={`${fmtNum(s.newUsers)} new this month`} />
        <Stat label="Active subscriptions" value={fmtNum(s.activeSubscriptions)} hint={`Revenue this month ${money(s.revenueMonthCents ?? 0)}`} />
        <Stat label="AI requests today" value={fmtNum(s.requestsToday)} hint={`${fmtNum(s.conversations)} conversations total`} />
        <Stat label="Errors (24h)" value={fmtNum(s.errors24h)} tone={(s.errors24h ?? 0) > 0 ? "warn" : "ok"} />
        <Stat label="Tokens this month" value={fmtNum(s.tokensMonth)} />
        <Stat label="API cost this month" value={fmtUsd(s.costMonthUsd, 4)} hint="Provider-reported or estimated from model pricing" />
        <Stat label="Models enabled" value={`${fmtNum(s.modelsEnabled)} / ${fmtNum(s.modelsTotal)}`} />
        <Stat label="Visible to customers" value={fmtNum(s.customerVisibleModels)} tone={s.customerVisibleModels ? "ok" : "err"} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Active engine</h2><Link href="/admin/routing" className="text-sm text-brand-400">Routing →</Link></div>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-400">Default provider</dt><dd>{e.activeProvider ?? <span className="text-amber-300">not set</span>}</dd>
            <dt className="text-slate-400">Default model</dt><dd>{e.effectiveDefaultModel ? `${e.effectiveDefaultModel.name} (${e.effectiveDefaultModel.provider})` : <span className="text-red-300">no usable model</span>}</dd>
            <dt className="text-slate-400">Fallback</dt><dd>{e.fallbackEnabled ? (e.fallbackModel ? `${e.fallbackModel.name} (${e.fallbackModel.provider})` : e.fallbackProvider ?? "enabled, no target") : "disabled"}</dd>
          </dl>
        </div>
        <div className="card">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Providers</h2><Link href="/admin/providers" className="text-sm text-brand-400">Manage →</Link></div>
          <ul className="mt-3 space-y-2 text-sm">
            {data.providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.name} <span className="text-xs text-slate-500">{p.type}</span>{!p.enabled && <span className="ml-2 text-xs text-slate-500">(disabled)</span>}{!p.hasApiKey && <span className="ml-2 text-xs text-amber-300">no API key</span>}</span>
                <HealthBadge status={p.healthStatus} />
              </li>
            ))}
          </ul>
          {data.providers.some((p) => p.lastHealthError) && <p className="mt-3 text-xs text-amber-300/90">{data.providers.find((p) => p.lastHealthError)?.lastHealthError}</p>}
        </div>
      </div>
    </>
  );
}
