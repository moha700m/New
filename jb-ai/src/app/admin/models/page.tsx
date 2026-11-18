"use client";
import { Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtNum } from "@/components/api";
import type { ModelRow, PlanRow, ProviderRow } from "@/components/admin/types";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

const CATS = ["TEXT", "REASONING", "CODE", "VISION", "IMAGE"] as const;
const CAPS: [keyof ModelRow, string][] = [
  ["supportsText", "Text generation"], ["supportsStreaming", "Streaming"], ["supportsVision", "Vision / image input"], ["supportsTools", "Tool calling"],
  ["supportsWebSearch", "Web search"], ["supportsReasoning", "Reasoning"], ["supportsStructuredOutput", "Structured output"], ["supportsImageGeneration", "Image generation"], ["supportsCode", "Optimized for code"],
];

type Draft = Partial<ModelRow> & { providerId?: string };

function ModelsInner() {
  const sp = useSearchParams();
  const [providerId, setProviderId] = useState(sp.get("providerId") ?? "");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const path = `/api/admin/models?providerId=${providerId}&status=${status}&category=${category}&q=${encodeURIComponent(query)}`;
  const { data, reload } = useAdmin<{ models: ModelRow[] }>(path);
  const providers = useAdmin<{ providers: ProviderRow[] }>("/api/admin/providers");
  const plans = useAdmin<{ plans: PlanRow[] }>("/api/admin/plans");
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; latencyMs: number; output: string; error: string | null }>>({});

  const models = data?.models ?? [];
  const allSelected = models.length > 0 && models.every((m) => selected.has(m.id));
  const counts = useMemo(() => ({ enabled: models.filter((m) => m.enabled).length, total: models.length }), [models]);

  async function saveDraft() {
    if (!draft) return;
    const body: Record<string, unknown> = {
      modelId: draft.modelId, displayName: draft.displayName, description: draft.description || null, category: draft.category, enabled: draft.enabled, sortOrder: Number(draft.sortOrder ?? 1000),
      contextLength: draft.contextLength ? Number(draft.contextLength) : null, maxOutputTokens: draft.maxOutputTokens ? Number(draft.maxOutputTokens) : null,
      inputPricePerM: draft.inputPricePerM === null || draft.inputPricePerM === undefined || (draft.inputPricePerM as unknown) === "" ? null : Number(draft.inputPricePerM),
      outputPricePerM: draft.outputPricePerM === null || draft.outputPricePerM === undefined || (draft.outputPricePerM as unknown) === "" ? null : Number(draft.outputPricePerM),
      planKeys: draft.planKeys ?? [],
    };
    for (const [k] of CAPS) body[k] = Boolean(draft[k]);
    const r = draft.id
      ? await run("save", () => api(`/api/admin/models/${draft.id}`, { method: "PATCH", body }), "Model saved — customers see the change immediately")
      : await run("save", () => api("/api/admin/models", { body: { ...body, providerId: draft.providerId } }), "Model added");
    if (r) {
      setDraft(null);
      void reload();
    }
  }

  async function bulk(action: "enable" | "disable" | "delete") {
    if (action === "delete" && !confirm(`Delete ${selected.size} models?`)) return;
    await run("bulk", () => api("/api/admin/models/bulk", { body: { ids: [...selected], action } }), `${action}d ${selected.size} models`);
    setSelected(new Set());
    void reload();
  }

  async function test(m: ModelRow) {
    const r = await run(`t${m.id}`, () => api<{ result: { ok: boolean; latencyMs: number; output: string; error: string | null } }>(`/api/admin/models/${m.id}/test`, { method: "POST" }));
    if (r) setTests((t) => ({ ...t, [m.id]: r.result }));
  }

  return (
    <>
      <PageHeader
        title="Model Management"
        subtitle={`${fmtNum(counts.enabled)} enabled of ${fmtNum(counts.total)} shown. Synced models come from each provider's live catalog; changes publish to customers instantly.`}
        actions={
          <>
            {providerId && <button className="btn-outline" disabled={busy === "sync"} onClick={() => run("sync", () => api<{ result: { discovered: number; created: number; removedFromCatalog: number } }>(`/api/admin/providers/${providerId}/sync`, { method: "POST" }), (r) => `Discovered ${r.result.discovered}; ${r.result.created} new; ${r.result.removedFromCatalog} no longer offered`).then(() => reload())}><RefreshCw size={15} /> {busy === "sync" ? "Syncing…" : "Sync from provider"}</button>}
            <button className="btn-primary" onClick={() => setDraft({ providerId: providerId || providers.data?.providers[0]?.id, category: "TEXT", enabled: true, supportsText: true, supportsStreaming: true, sortOrder: 100, planKeys: [] })}><Plus size={16} /> Add model manually</button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-auto" value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Provider">
          <option value="">All providers</option>
          {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </select>
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="input min-w-[160px]" placeholder="Search model id or name" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-outline"><Search size={15} /></button>
        </form>
      </div>
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-sm">
          {selected.size} selected
          <button className="btn-outline px-2.5 py-1" onClick={() => bulk("enable")}>Enable</button>
          <button className="btn-outline px-2.5 py-1" onClick={() => bulk("disable")}>Disable</button>
          <button className="btn-outline px-2.5 py-1 text-red-300" onClick={() => bulk("delete")}>Delete</button>
          <button className="btn-ghost px-2.5 py-1" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <Table head={[<input key="a" type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(models.map((m) => m.id)))} />, "Model", "Provider", "Category", "Capabilities", "Pricing / ctx", "Plans", "Status", ""]} empty={data?.models.length === 0}>
        {models.map((m) => (
          <tr key={m.id} className={`align-top ${!m.inCatalog ? "opacity-60" : ""}`}>
            <td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${m.displayName}`} checked={selected.has(m.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} /></td>
            <td className="max-w-[260px] px-3 py-3">
              <div className="font-medium">{m.displayName}</div>
              <div className="break-all font-mono text-xs text-slate-500">{m.modelId}</div>
              {tests[m.id] && <div className={`mt-1 text-xs ${tests[m.id]!.ok ? "text-emerald-300" : "text-red-300"}`}>{tests[m.id]!.ok ? `✓ ${tests[m.id]!.latencyMs}ms: ${tests[m.id]!.output.slice(0, 80)}` : `✗ ${tests[m.id]!.error}`}</div>}
            </td>
            <td className="px-3 py-3 text-xs">{m.provider.name}<div className="text-slate-500">{m.source.toLowerCase()}{!m.inCatalog && " · not in live catalog"}{m.offline && " · offline"}</div></td>
            <td className="px-3 py-3 text-xs">{m.category.toLowerCase()}</td>
            <td className="px-3 py-3 text-[11px] text-slate-400">{CAPS.filter(([k]) => m[k]).map(([, l]) => l.split(" ")[0]).join(", ")}</td>
            <td className="px-3 py-3 text-xs text-slate-400">{m.inputPricePerM != null ? `$${m.inputPricePerM}/$${m.outputPricePerM} per M` : "—"}<div>{m.contextLength ? `${fmtNum(m.contextLength)} ctx` : ""}</div></td>
            <td className="px-3 py-3 text-xs">{m.planKeys.join(", ") || <span className="text-slate-500">all-model plans only</span>}</td>
            <td className="px-3 py-3"><button onClick={() => run(`e${m.id}`, () => api(`/api/admin/models/${m.id}`, { method: "PATCH", body: { enabled: !m.enabled } }), m.enabled ? "Model disabled" : "Model enabled").then(() => reload())} aria-label="Toggle enabled"><OnOff on={m.enabled} /></button></td>
            <td className="px-3 py-3">
              <div className="flex justify-end gap-1">
                <button className="btn-outline px-2 py-1" disabled={busy === `t${m.id}`} onClick={() => test(m)} title="Send a live test request"><Play size={13} /> {busy === `t${m.id}` ? "…" : "Test"}</button>
                <button className="btn-outline px-2 py-1" onClick={() => setDraft({ ...m })}>Edit</button>
                <button className="btn-ghost px-1.5 py-1 text-red-300" aria-label="Delete model" onClick={() => confirm(`Delete ${m.displayName}?`) && run("d", () => api(`/api/admin/models/${m.id}`, { method: "DELETE" }), "Model deleted").then(() => reload())}><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Edit ${draft.displayName}` : "Add model"} wide>
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            {!draft.id && (
              <Field label="Provider">
                <select className="input" value={draft.providerId} onChange={(e) => setDraft({ ...draft, providerId: e.target.value })}>
                  {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Model ID (sent to provider)"><input className="input font-mono" value={draft.modelId ?? ""} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} /></Field>
            <Field label="Display name"><input className="input" value={draft.displayName ?? ""} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ModelRow["category"] })}>{CATS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select>
            </Field>
            <div className="sm:col-span-2"><Field label="Description"><textarea className="input min-h-[70px]" value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field></div>
            <Field label="Sort order" hint="Lower appears first"><input className="input" type="number" value={draft.sortOrder ?? 1000} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></Field>
            <Field label="Context length"><input className="input" type="number" value={draft.contextLength ?? ""} onChange={(e) => setDraft({ ...draft, contextLength: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Input $ / 1M tokens"><input className="input" type="number" step="0.0001" value={draft.inputPricePerM ?? ""} onChange={(e) => setDraft({ ...draft, inputPricePerM: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Output $ / 1M tokens"><input className="input" type="number" step="0.0001" value={draft.outputPricePerM ?? ""} onChange={(e) => setDraft({ ...draft, outputPricePerM: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <p className="label">Capabilities</p>
              <div className="grid gap-2 sm:grid-cols-3">{CAPS.map(([k, l]) => <Toggle key={k} checked={Boolean(draft[k])} onChange={(v) => setDraft({ ...draft, [k]: v })} label={l} />)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="label">Available on plans</p>
              <div className="flex flex-wrap gap-3">
                {plans.data?.plans.map((p) => (
                  <Toggle key={p.key} checked={p.allowAllModels || (draft.planKeys ?? []).includes(p.key)} disabled={p.allowAllModels} hint={p.allowAllModels ? "includes all models" : undefined}
                    onChange={(v) => setDraft({ ...draft, planKeys: v ? [...(draft.planKeys ?? []), p.key] : (draft.planKeys ?? []).filter((x) => x !== p.key) })} label={p.name} />
                ))}
              </div>
            </div>
            <div className="sm:col-span-2"><Toggle checked={Boolean(draft.enabled)} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Enabled (visible to customers)" /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy === "save" || !draft.modelId || !draft.displayName} onClick={saveDraft}>{busy === "save" ? "Saving…" : "Save model"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function ModelsPage() {
  return (
    <Suspense>
      <ModelsInner />
    </Suspense>
  );
}
