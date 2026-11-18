"use client";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import type { ModelRow, ProviderRow } from "@/components/admin/types";
import { Field, PageHeader, useAction, useAdmin } from "@/components/admin/ui";
import { Toggle } from "@/components/ui/Toggle";

type Routing = Record<string, string | boolean | null>;
const ROLES: [string, string, (m: ModelRow) => boolean][] = [
  ["defaultTextModelId", "Default text model", (m) => m.supportsText],
  ["defaultReasoningModelId", "Default reasoning model (Think)", (m) => m.supportsText],
  ["defaultCodingModelId", "Default coding model", (m) => m.supportsText],
  ["defaultVisionModelId", "Default vision model (image input)", (m) => m.supportsText && m.supportsVision],
  ["defaultImageModelId", "Default image generation model", (m) => m.supportsImageGeneration],
];

export default function RoutingPage() {
  const { data, reload } = useAdmin<{ routing: Routing }>("/api/admin/routing");
  const [showAll, setShowAll] = useState(false);
  const models = useAdmin<{ models: ModelRow[] }>(`/api/admin/models?status=${showAll ? "all" : "enabled"}`);
  const providers = useAdmin<{ providers: ProviderRow[] }>("/api/admin/providers");
  const { run, busy } = useAction();
  const [r, setR] = useState<Routing | null>(null);
  useEffect(() => setR(data?.routing ?? null), [data]);
  if (!r) return <p className="text-slate-400">Loading…</p>;

  const list = models.data?.models ?? [];
  const select = (key: string, filter: (m: ModelRow) => boolean, providerScope?: string | null) => (
    <select className="input" value={(r[key] as string) ?? ""} onChange={(e) => setR({ ...r, [key]: e.target.value || null })}>
      <option value="">— automatic —</option>
      {(providers.data?.providers ?? []).filter((p) => !providerScope || p.id === providerScope).map((p) => {
        const opts = list.filter((m) => m.providerId === p.id && filter(m));
        if (!opts.length) return null;
        return (
          <optgroup key={p.id} label={p.name}>
            {opts.map((m) => <option key={m.id} value={m.id}>{m.displayName}{!m.enabled ? " (disabled — will be enabled)" : ""}</option>)}
          </optgroup>
        );
      })}
    </select>
  );

  async function save() {
    const body: Routing = {};
    for (const k of ["defaultProviderId", "defaultTextModelId", "defaultReasoningModelId", "defaultCodingModelId", "defaultVisionModelId", "defaultImageModelId", "fallbackEnabled", "fallbackProviderId", "fallbackModelId"]) body[k] = r![k] ?? null;
    body.fallbackEnabled = Boolean(r!.fallbackEnabled);
    const ok = await run("save", () => api("/api/admin/routing", { method: "PUT", body }), "Routing saved — new requests use it immediately");
    if (ok) { void reload(); void models.reload(); }
  }

  return (
    <>
      <PageHeader title="Routing Rules" subtitle="Server-side routing for every AI request. Customers can only choose catalog models; providers, URLs and credentials always come from here." actions={<button className="btn-primary" disabled={busy === "save"} onClick={save}><Save size={15} /> Save routing</button>} />
      <div className="mb-4"><Toggle checked={showAll} onChange={setShowAll} label="Include disabled models in lists" /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-semibold">Defaults</h2>
          <Field label="Default AI provider" hint="Used when no default model is set for a role.">
            <select className="input" value={(r.defaultProviderId as string) ?? ""} onChange={(e) => setR({ ...r, defaultProviderId: e.target.value || null })}>
              <option value="">— none —</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.enabled ? " (disabled)" : ""}</option>)}
            </select>
          </Field>
          {ROLES.map(([k, label, f]) => <Field key={k} label={label}>{select(k, f)}</Field>)}
        </div>
        <div className="card space-y-4">
          <h2 className="font-semibold">Fallback</h2>
          <Toggle checked={Boolean(r.fallbackEnabled)} onChange={(v) => setR({ ...r, fallbackEnabled: v })} label="Enable automatic fallback" hint="If the primary provider fails before responding (auth, credits, timeout, 5xx), the request is retried on the fallback." />
          <Field label="Fallback provider" hint="Tries the same model ID on this provider first, then its first enabled model.">
            <select className="input" value={(r.fallbackProviderId as string) ?? ""} onChange={(e) => setR({ ...r, fallbackProviderId: e.target.value || null })}>
              <option value="">— none —</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Fallback model">{select("fallbackModelId", (m) => m.supportsText || m.supportsImageGeneration)}</Field>
          <div className="rounded-lg bg-ink-800 p-3 text-xs leading-5 text-slate-400">
            Request flow: authenticated user → plan &amp; quota check → requested catalog model (or role default) → provider adapter → on failure before the first token: one retry for transient errors, then fallback target. Answers from two models are never mixed.
          </div>
        </div>
      </div>
    </>
  );
}
