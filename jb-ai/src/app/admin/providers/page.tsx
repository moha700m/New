"use client";
import { KeyRound, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { api, fmtDate } from "@/components/api";
import { Field, HealthBadge, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

import type { ProviderRow } from "@/components/admin/types";
type Types = { type: string; label: string; defaultBaseUrl: string; authHeader: string; authScheme: string }[];

const blank = { name: "", slug: "", type: "OPENAI_COMPATIBLE", baseUrl: "", apiKey: "", authHeader: "Authorization", authScheme: "Bearer", extraHeaders: "", priority: 100, timeoutMs: 120000, enabled: true };

export default function ProvidersPage() {
  const { data, reload } = useAdmin<{ providers: ProviderRow[]; types: Types }>("/api/admin/providers");
  const { run, busy } = useAction();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [keyFor, setKeyFor] = useState<ProviderRow | null>(null);
  const [newKey, setNewKey] = useState("");
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string; latencyMs: number }>>({});

  function openNew() {
    setEditing(null);
    setForm({ ...blank });
  }
  function openEdit(p: ProviderRow) {
    setEditing(p);
    setForm({ name: p.name, slug: p.slug, type: p.type, baseUrl: p.baseUrl, apiKey: "", authHeader: p.authHeader, authScheme: p.authScheme, extraHeaders: p.extraHeaders ? JSON.stringify(p.extraHeaders) : "", priority: p.priority, timeoutMs: p.timeoutMs, enabled: p.enabled });
  }

  async function save() {
    if (!form) return;
    let extra: Record<string, string> | undefined;
    if (form.extraHeaders.trim()) {
      try {
        extra = JSON.parse(form.extraHeaders);
      } catch {
        return alert("Extra headers must be valid JSON, e.g. {\"HTTP-Referer\": \"https://example.com\"}");
      }
    }
    const body = { name: form.name, slug: form.slug, type: form.type, baseUrl: form.baseUrl, authHeader: form.authHeader, authScheme: form.authScheme, priority: Number(form.priority), timeoutMs: Number(form.timeoutMs), enabled: form.enabled, extraHeaders: extra, ...(form.apiKey ? { apiKey: form.apiKey } : {}) };
    const r = await run("save", () => (editing ? api(`/api/admin/providers/${editing.id}`, { method: "PATCH", body }) : api("/api/admin/providers", { body })), editing ? "Provider updated — live config published" : "Provider added");
    if (r) {
      setForm(null);
      void reload();
    }
  }

  async function test(p: ProviderRow) {
    const r = await run(`test-${p.id}`, () => api<{ result: { ok: boolean; detail: string; latencyMs: number } }>(`/api/admin/providers/${p.id}/test`, { method: "POST" }));
    if (r) {
      setTestResult((t) => ({ ...t, [p.id]: r.result }));
      void reload();
    }
  }

  return (
    <>
      <PageHeader title="AI Providers" subtitle="Add providers, manage credentials (encrypted at rest), test connectivity and set priority." actions={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Add provider</button>} />
      <Table head={["Provider", "Endpoint", "API key", "Status", "Models", "Priority", ""]} empty={data?.providers.length === 0}>
        {data?.providers.map((p) => (
          <tr key={p.id} className="align-top">
            <td className="px-3 py-3">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-slate-500">{p.type} · {p.slug}</div>
              <div className="mt-1"><OnOff on={p.enabled} /></div>
            </td>
            <td className="max-w-[220px] break-all px-3 py-3 text-xs text-slate-400">{p.baseUrl}</td>
            <td className="px-3 py-3 text-xs">{p.hasApiKey ? <span className="font-mono">••••{p.apiKeyLast4}</span> : <span className="text-amber-300">not set</span>}</td>
            <td className="px-3 py-3">
              <HealthBadge status={p.healthStatus} />
              {p.healthLatencyMs != null && <div className="mt-1 text-xs text-slate-500">{p.healthLatencyMs} ms · {fmtDate(p.lastHealthAt, true)}</div>}
              {(testResult[p.id]?.detail || p.lastHealthError) && <div className={`mt-1 max-w-[260px] text-xs ${testResult[p.id]?.ok ? "text-emerald-300" : "text-amber-300"}`}>{testResult[p.id]?.detail ?? p.lastHealthError}</div>}
            </td>
            <td className="px-3 py-3 text-xs text-slate-400">
              {p.enabledModelCount} enabled / {p.modelCount}
              <div>{p.lastSyncAt ? `Synced ${fmtDate(p.lastSyncAt, true)} (${p.lastSyncStatus})` : "Never synced"}</div>
              {p.lastSyncError && <div className="text-red-300">{p.lastSyncError}</div>}
            </td>
            <td className="px-3 py-3">{p.priority}</td>
            <td className="px-3 py-3">
              <div className="flex flex-wrap justify-end gap-1.5">
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `test-${p.id}`} onClick={() => test(p)}><Wifi size={14} /> {busy === `test-${p.id}` ? "Testing…" : "Test"}</button>
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `sync-${p.id}`} onClick={() => run(`sync-${p.id}`, () => api<{ result: { discovered: number; created: number } }>(`/api/admin/providers/${p.id}/sync`, { method: "POST" }), (r) => `Discovered ${r.result.discovered} models (${r.result.created} new)`).then(() => reload())}><RefreshCw size={14} /> Sync models</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => { setKeyFor(p); setNewKey(""); }}><KeyRound size={14} /> {p.hasApiKey ? "Replace key" : "Add key"}</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`en-${p.id}`, () => api(`/api/admin/providers/${p.id}`, { method: "PATCH", body: { enabled: !p.enabled } }), p.enabled ? "Provider disabled" : "Provider enabled").then(() => reload())}>{p.enabled ? "Disable" : "Enable"}</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn-ghost px-2 py-1.5 text-red-300" aria-label="Delete provider" onClick={() => confirm(`Delete ${p.name} and all its models?`) && run("del", () => api(`/api/admin/providers/${p.id}`, { method: "DELETE" }), "Provider deleted").then(() => reload())}><Trash2 size={15} /></button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!form} onClose={() => setForm(null)} title={editing ? `Edit ${editing.name}` : "Add provider"} wide>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider type">
              <select
                className="input"
                value={form.type}
                onChange={(e) => {
                  const t = data?.types.find((x) => x.type === e.target.value);
                  setForm({ ...form, type: e.target.value, baseUrl: form.baseUrl || t?.defaultBaseUrl || "", authHeader: t?.authHeader ?? "Authorization", authScheme: t?.authScheme ?? "Bearer" });
                }}
              >
                {data?.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Display name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: editing ? form.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} /></Field>
            <Field label="Slug"><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="API base URL" hint="e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1"><input className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={data?.types.find((t) => t.type === form.type)?.defaultBaseUrl} /></Field>
            <Field label={editing ? "API key (leave empty to keep current)" : "API key"} hint="Encrypted with AES-256-GCM. Never shown again or sent to browsers."><input className="input font-mono" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Auth header"><input className="input" value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} /></Field>
              <Field label="Auth scheme"><input className="input" value={form.authScheme} onChange={(e) => setForm({ ...form, authScheme: e.target.value })} placeholder="Bearer" /></Field>
            </div>
            <Field label="Extra headers (JSON)" hint='Optional, e.g. {"HTTP-Referer":"https://your.site"}'><input className="input font-mono text-xs" value={form.extraHeaders} onChange={(e) => setForm({ ...form, extraHeaders: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Priority" hint="Lower = preferred"><input className="input" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></Field>
              <Field label="Timeout (ms)"><input className="input" type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} /></Field>
            </div>
            <div className="sm:col-span-2"><Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save provider"}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!keyFor} onClose={() => setKeyFor(null)} title={`${keyFor?.hasApiKey ? "Replace" : "Add"} API key — ${keyFor?.name ?? ""}`}>
        <p className="mb-3 text-sm text-slate-400">The new key is encrypted before it is stored and takes effect for the next request. The old key is discarded.</p>
        <input className="input font-mono" type="password" autoComplete="off" placeholder="Paste API key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {keyFor?.hasApiKey && <button className="btn-ghost text-red-300" onClick={() => run("clr", () => api(`/api/admin/providers/${keyFor!.id}`, { method: "PATCH", body: { clearApiKey: true } }), "Key removed").then(() => { setKeyFor(null); reload(); })}>Remove key</button>}
          <button className="btn-primary" disabled={!newKey.trim()} onClick={() => run("key", () => api(`/api/admin/providers/${keyFor!.id}`, { method: "PATCH", body: { apiKey: newKey.trim() } }), "Credentials replaced").then(async (r) => { if (r) { const p = keyFor!; setKeyFor(null); await reload(); void test(p); } })}>Save & test</button>
        </div>
      </Modal>
    </>
  );
}
