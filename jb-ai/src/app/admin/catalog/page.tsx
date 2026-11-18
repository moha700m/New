"use client";
import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import Link from "next/link";
import { api } from "@/components/api";
import type { ModelRow, PlanRow } from "@/components/admin/types";
import { PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { useLiveConfig } from "@/components/useLiveConfig";

export default function CatalogPage() {
  const { data, reload } = useAdmin<{ models: ModelRow[] }>("/api/admin/models?status=enabled");
  const plans = useAdmin<{ plans: PlanRow[] }>("/api/admin/plans");
  const { config } = useLiveConfig();
  const { run } = useAction();
  const models = (data?.models ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= models.length) return;
    const order = models.map((m, idx) => ({ id: m.id, sortOrder: (idx + 1) * 10 }));
    const a = order[i]!.sortOrder;
    order[i]!.sortOrder = order[j]!.sortOrder;
    order[j]!.sortOrder = a;
    await run("reorder", () => api("/api/admin/models/bulk", { body: { ids: order.map((o) => o.id), action: "reorder", order } }));
    void reload();
  }

  async function togglePlan(m: ModelRow, key: string) {
    const planKeys = m.planKeys.includes(key) ? m.planKeys.filter((k) => k !== key) : [...m.planKeys, key];
    await run("plan", () => api(`/api/admin/models/${m.id}`, { method: "PATCH", body: { planKeys } }), "Plan availability updated");
    void reload();
  }

  const name = (id: string | null | undefined) => config?.models.find((m) => m.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Model Catalog" subtitle="Exactly what customers see in the model selector: order, availability by plan and live defaults." actions={<Link href="/" target="_blank" className="btn-outline"><Eye size={15} /> Open customer view</Link>} />
      <div className="card mb-5">
        <p className="text-sm text-slate-400">Live customer catalog <b className="text-white">v{config?.version ?? "…"}</b> — {config?.models.length ?? 0} models visible.</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-5">
          {(["text", "reasoning", "code", "vision", "image"] as const).map((r) => (
            <div key={r} className="rounded-lg bg-ink-800 px-3 py-2"><div className="text-xs uppercase text-slate-500">{r}</div><div className="truncate">{name(config?.defaults[r])}</div></div>
          ))}
        </div>
      </div>
      <Table head={["#", "Model", "Provider", "Category", ...(plans.data?.plans.map((p) => p.name) ?? []), "Visible", "Order"]} empty={models.length === 0}>
        {models.map((m, i) => {
          const visible = config?.models.some((x) => x.id === m.id);
          return (
            <tr key={m.id}>
              <td className="px-3 py-2 text-slate-500">{i + 1}</td>
              <td className="px-3 py-2"><div className="font-medium">{m.displayName}</div><div className="font-mono text-xs text-slate-500">{m.modelId}</div></td>
              <td className="px-3 py-2 text-xs">{m.provider.name}</td>
              <td className="px-3 py-2 text-xs">{m.category.toLowerCase()}</td>
              {plans.data?.plans.map((p) => (
                <td key={p.key} className="px-3 py-2">
                  <input type="checkbox" aria-label={`${m.displayName} on ${p.name}`} checked={p.allowAllModels || m.planKeys.includes(p.key)} disabled={p.allowAllModels} onChange={() => togglePlan(m, p.key)} />
                </td>
              ))}
              <td className="px-3 py-2 text-xs">{visible ? <span className="text-emerald-300">yes</span> : <span className="text-amber-300" title="Provider disabled, offline or not in live catalog">hidden</span>}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1">
                  <button className="btn-ghost p-1" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                  <button className="btn-ghost p-1" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
