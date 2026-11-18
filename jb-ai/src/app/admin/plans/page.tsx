"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { api, money } from "@/components/api";
import type { ModelRow, PlanRow } from "@/components/admin/types";
import { Field, OnOff, PageHeader, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

type Draft = Omit<PlanRow, "id" | "subscriberCount"> & { id?: string; featuresText: string };
const empty: Draft = { key: "", name: "", description: "", features: [], featuresText: "", priceMonthlyCents: 0, priceYearlyCents: 0, currency: "usd", dailyMessageLimit: null, monthlyMessageLimit: null, monthlyTokenLimit: null, maxUploadMb: 5, allowUploads: true, allowWebSearch: false, allowImageGeneration: false, allowAllModels: false, isDefault: false, active: true, sortOrder: 10, modelIds: [] };

const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));

export default function PlansAdmin() {
  const { data, reload } = useAdmin<{ plans: PlanRow[] }>("/api/admin/plans");
  const models = useAdmin<{ models: ModelRow[] }>("/api/admin/models?status=enabled");
  const { run, busy } = useAction();
  const [d, setD] = useState<Draft | null>(null);

  async function save() {
    if (!d) return;
    const { id, featuresText, ...rest } = d;
    const body = { ...rest, features: featuresText.split("\n").map((s) => s.trim()).filter(Boolean), description: rest.description || null };
    const ok = await run("save", () => (id ? api(`/api/admin/plans/${id}`, { method: "PUT", body }) : api("/api/admin/plans", { body })), "Plan saved — limits and model access apply immediately");
    if (ok) { setD(null); void reload(); }
  }

  return (
    <>
      <PageHeader title="Subscription Plans" subtitle="Prices, usage limits, features and model access per plan. Checkout uses these prices directly." actions={<button className="btn-primary" onClick={() => setD({ ...empty })}><Plus size={16} /> New plan</button>} />
      <div className="grid gap-4 md:grid-cols-3">
        {data?.plans.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{p.name}</h3><p className="text-xs text-slate-500">{p.key}{p.isDefault && " · default (free) plan"}</p></div>
              <OnOff on={p.active} onLabel="active" offLabel="inactive" />
            </div>
            <p className="mt-2 text-sm">{money(p.priceMonthlyCents, p.currency)}/mo · {money(p.priceYearlyCents, p.currency)}/yr</p>
            <ul className="mt-3 space-y-1 text-xs text-slate-400">
              <li>Daily messages: {p.dailyMessageLimit ?? "unlimited"}</li>
              <li>Monthly messages: {p.monthlyMessageLimit ?? "unlimited"}</li>
              <li>Monthly tokens: {p.monthlyTokenLimit?.toLocaleString() ?? "unlimited"}</li>
              <li>Uploads: {p.allowUploads ? `up to ${p.maxUploadMb} MB` : "no"} · Web search: {p.allowWebSearch ? "yes" : "no"} · Images: {p.allowImageGeneration ? "yes" : "no"}</li>
              <li>Models: {p.allowAllModels ? "all enabled models" : `${p.modelIds.length} selected`}</li>
              <li>Subscribers: {p.subscriberCount}</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <button className="btn-outline px-3 py-1.5" onClick={() => setD({ ...p, featuresText: (p.features ?? []).join("\n") })}>Edit</button>
              {!p.isDefault && <button className="btn-ghost px-3 py-1.5 text-red-300" onClick={() => confirm(`Delete plan ${p.name}?`) && run("del", () => api(`/api/admin/plans/${p.id}`, { method: "DELETE" }), "Plan deleted").then(() => reload())}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!d} onClose={() => setD(null)} title={d?.id ? `Edit ${d.name}` : "New plan"} wide>
        {d && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key"><input className="input" value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })} /></Field>
            <Field label="Name"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><input className="input" value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field></div>
            <Field label="Monthly price (cents)"><input className="input" type="number" value={d.priceMonthlyCents} onChange={(e) => setD({ ...d, priceMonthlyCents: Number(e.target.value) })} /></Field>
            <Field label="Yearly price (cents)"><input className="input" type="number" value={d.priceYearlyCents} onChange={(e) => setD({ ...d, priceYearlyCents: Number(e.target.value) })} /></Field>
            <Field label="Currency"><input className="input" value={d.currency} maxLength={3} onChange={(e) => setD({ ...d, currency: e.target.value.toLowerCase() })} /></Field>
            <Field label="Sort order"><input className="input" type="number" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: Number(e.target.value) })} /></Field>
            <Field label="Daily message limit" hint="Empty = unlimited"><input className="input" type="number" value={d.dailyMessageLimit ?? ""} onChange={(e) => setD({ ...d, dailyMessageLimit: num(e.target.value) })} /></Field>
            <Field label="Monthly message limit" hint="Empty = unlimited"><input className="input" type="number" value={d.monthlyMessageLimit ?? ""} onChange={(e) => setD({ ...d, monthlyMessageLimit: num(e.target.value) })} /></Field>
            <Field label="Monthly token limit" hint="Empty = unlimited"><input className="input" type="number" value={d.monthlyTokenLimit ?? ""} onChange={(e) => setD({ ...d, monthlyTokenLimit: num(e.target.value) })} /></Field>
            <Field label="Max upload (MB)"><input className="input" type="number" value={d.maxUploadMb} onChange={(e) => setD({ ...d, maxUploadMb: Number(e.target.value) })} /></Field>
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
              <Toggle checked={d.allowUploads} onChange={(v) => setD({ ...d, allowUploads: v })} label="File uploads" />
              <Toggle checked={d.allowWebSearch} onChange={(v) => setD({ ...d, allowWebSearch: v })} label="Web search" />
              <Toggle checked={d.allowImageGeneration} onChange={(v) => setD({ ...d, allowImageGeneration: v })} label="Image generation" />
              <Toggle checked={d.allowAllModels} onChange={(v) => setD({ ...d, allowAllModels: v })} label="All models" />
              <Toggle checked={Boolean(d.isDefault)} onChange={(v) => setD({ ...d, isDefault: v })} label="Default (free) plan" />
              <Toggle checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="Active" />
            </div>
            <div className="sm:col-span-2"><Field label="Features (one per line, shown on pricing page)"><textarea className="input min-h-[90px]" value={d.featuresText} onChange={(e) => setD({ ...d, featuresText: e.target.value })} /></Field></div>
            {!d.allowAllModels && (
              <div className="sm:col-span-2">
                <p className="label">Models available on this plan ({d.modelIds.length})</p>
                <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-ink-600 p-3 sm:grid-cols-2">
                  {models.data?.models.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={d.modelIds.includes(m.id)} onChange={(e) => setD({ ...d, modelIds: e.target.checked ? [...d.modelIds, m.id] : d.modelIds.filter((x) => x !== m.id) })} />
                      <span className="truncate">{m.displayName}</span><span className="text-xs text-slate-500">{m.provider.name}</span>
                    </label>
                  ))}
                  {!models.data?.models.length && <p className="text-sm text-slate-500">Enable models first in Model Management.</p>}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setD(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy === "save"} onClick={save}>Save plan</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
