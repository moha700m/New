"use client";
import { CheckCircle2, ChevronDown, ExternalLink, Github, Link2, Plug, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { AddConnector } from "@/components/chat/AddConnector";

type Server = {
  id: string; slug: string; name: string; url: string; transport: string; authHeader: string; authScheme: string; authType: string;
  hasToken: boolean; tokenLast4: string | null; extraHeaders: Record<string, string> | null; enabled: boolean; toolFilter: string | null;
  toolCount: number; tools: { name: string; description: string }[]; lastSyncAt: string | null; lastError: string | null;
  connectedAt: string | null; connectedAs: string | null; oauthIssuer: string | null; tokenExpiresAt: string | null;
};
type Preset = { key: string; name: string; url: string; desc: string };
type ConnectEvent = { id: string; kind: string; step: string; target: string | null; ok: boolean; message: string | null; createdAt: string };
type GithubState = { appCreated: boolean; appSlug: string | null; appName: string | null; appHtmlUrl: string | null; installUrl: string | null; connected: boolean; login: string | null; avatarUrl: string | null; connectedAt: string | null };

const blank = { name: "", slug: "", url: "", transport: "auto", authHeader: "Authorization", authScheme: "Bearer", token: "", extraHeaders: "", toolFilter: "", enabled: true };

function isConnected(s: Server) {
  if (s.authType === "oauth" || s.authType === "github") return Boolean(s.connectedAt);
  if (s.authType === "token") return s.hasToken;
  return Boolean(s.lastSyncAt && !s.lastError);
}

function authLabel(s: Server) {
  if (s.authType === "github") return "GitHub App";
  if (s.authType === "oauth") return "OAuth";
  if (s.authType === "token") return "توكن (متقدم)";
  return "بدون تسجيل دخول";
}

export default function McpPage() {
  const { data, reload } = useAdmin<{ servers: Server[]; presets: Preset[]; github: GithubState; events: ConnectEvent[] }>("/api/admin/mcp");
  const { run, busy } = useAction();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<Server | null>(null);
  const [openTools, setOpenTools] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const gh = data?.github;
  const bySlug = new Map((data?.servers ?? []).map((s) => [s.slug, s]));

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) setFlash({ ok: true, text: `تم الربط ✓ ${q.get("connected") === "github" ? "GitHub" : q.get("connected")}${q.get("tools") ? ` — ${q.get("tools")} أداة` : ""}` });
    else if (q.get("error")) setFlash({ ok: false, text: q.get("error")! });
    else if (q.get("github") === "installed") setFlash({ ok: true, text: "تم تثبيت تطبيق GitHub. اضغط «ربط الحساب» لإكمال الربط." });
    if (q.toString()) window.history.replaceState(null, "", "/admin/mcp");
  }, []);

  // Full-page navigations (no fetch-then-redirect): reliable on mobile Safari and in-app browsers.
  function connect(body: { serverId?: string; preset?: string }, key: string) {
    setFlash(null);
    setPending(key);
    const q = new URLSearchParams({ back: "/admin/mcp", ...(body.serverId ? { id: body.serverId } : {}), ...(body.preset ? { preset: body.preset } : {}) });
    window.location.href = `/api/connect/mcp?${q}`;
  }

  function githubCreateApp() {
    setPending("gh-app");
    window.location.href = "/api/connect/github?new=1&back=/admin/mcp";
  }

  function githubConnect() {
    setPending("gh-conn");
    window.location.href = "/api/connect/github?back=/admin/mcp";
  }

  function openEdit(s: Server) {
    setEditing(s);
    setForm({ name: s.name, slug: s.slug, url: s.url, transport: s.transport, authHeader: s.authHeader, authScheme: s.authScheme, token: "", extraHeaders: s.extraHeaders ? JSON.stringify(s.extraHeaders) : "", toolFilter: s.toolFilter ?? "", enabled: s.enabled });
  }

  async function saveAdvanced() {
    if (!form || !editing) return;
    let extra: Record<string, string> | undefined;
    if (form.extraHeaders.trim()) {
      try {
        extra = JSON.parse(form.extraHeaders);
      } catch {
        return alert('الترويسات الإضافية لازم تكون JSON صحيح، مثل {"X-Header":"value"}');
      }
    }
    const body = { name: form.name, slug: form.slug, url: form.url, transport: form.transport, authHeader: form.authHeader, authScheme: form.authScheme, extraHeaders: extra, toolFilter: form.toolFilter || null, enabled: form.enabled, ...(form.token.trim() ? { token: form.token.trim() } : {}) };
    const r = await run("save", () => api(`/api/admin/mcp/${editing.id}`, { method: "PATCH", body }), "تم الحفظ");
    if (r) {
      setForm(null);
      void reload();
    }
  }

  return (
    <>
      <PageHeader title="الموصّلات (وضع الوكيل)" subtitle="اربط حساباتك بضغطة — مثل Claude و ChatGPT. تسجّل دخولك في صفحة الخدمة نفسها، والموقع يحفظ الصلاحية مشفّرة ويجددها تلقائيًا." />

      {flash && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${flash.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>{flash.text}</div>
      )}

      {/* ---------------- GitHub */}
      <div className="card mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Github size={26} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">GitHub</div>
            <div className="text-sm text-slate-400">الوكيل يقرأ مستودعاتك ويعدّل الملفات ويسوي فروع و commits و PRs و issues.</div>
          </div>
          {gh?.connected ? (
            <div className="flex items-center gap-2 text-sm">
              {gh.avatarUrl && <img src={gh.avatarUrl} alt="" className="h-7 w-7 rounded-full" />}
              <span className="text-emerald-300"><CheckCircle2 size={15} className="me-1 inline" />مربوط كـ <b dir="ltr">@{gh.login}</b></span>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!gh?.appCreated && (
            <button className="btn-primary" disabled={!data || pending === "gh-app"} onClick={githubCreateApp} data-testid="github-connect"><Github size={15} /> {pending === "gh-app" ? "جارٍ التحويل لـ GitHub…" : "ربط GitHub"}</button>
          )}
          {gh?.appCreated && !gh.connected && (
            <>
              <button className="btn-primary" disabled={pending === "gh-conn"} onClick={githubConnect}><Link2 size={15} /> ربط الحساب</button>
              {gh.installUrl && <a className="btn-outline" href={gh.installUrl}><ExternalLink size={14} /> تثبيت على المستودعات</a>}
            </>
          )}
          {gh?.connected && (
            <>
              {gh.installUrl && <a className="btn-outline px-2.5 py-1.5" href={gh.installUrl}><ExternalLink size={14} /> اختيار المستودعات</a>}
              <button className="btn-outline px-2.5 py-1.5" disabled={pending === "gh-conn"} onClick={githubConnect}><RefreshCw size={14} /> إعادة الربط</button>
              <button className="btn-ghost px-2.5 py-1.5 text-red-300" onClick={() => confirm("قطع اتصال GitHub؟") && run("gh-dis", () => api("/api/admin/github/disconnect", { body: {} }), "تم قطع الاتصال").then(() => reload())}><Unlink size={14} /> قطع الاتصال</button>
            </>
          )}
        </div>
        {!gh?.appCreated && <p className="mt-2 text-xs text-slate-500">أول مرة: GitHub يفتح صفحة «Create GitHub App» — اضغط الزر الأخضر، بعدها اختر المستودعات واضغط Install. بدون أي توكن.</p>}
        {gh?.appName && <p className="mt-2 text-xs text-slate-500">تطبيقك الخاص على GitHub: <a className="underline" href={gh.appHtmlUrl ?? "#"} target="_blank" rel="noreferrer">{gh.appName}</a></p>}
      </div>

      {/* ---------------- Gallery */}
      <h2 className="mb-2 text-sm font-semibold text-slate-300">موصّلات جاهزة</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data?.presets.map((p) => {
          const s = bySlug.get(p.key);
          const on = s ? isConnected(s) : false;
          return (
            <div key={p.key} className="card flex items-center gap-3 p-3.5" data-testid={`connector-${p.key}`}>
              <Plug size={20} className={on ? "text-emerald-300" : "text-slate-500"} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="truncate text-xs text-slate-500">{on ? `مربوط${s?.toolCount ? ` · ${s.toolCount} أداة` : ""}` : p.desc}</div>
              </div>
              {on && s ? (
                <button className="btn-ghost px-2 py-1 text-xs text-slate-400" onClick={() => run(`dis-${s.id}`, () => api(`/api/admin/mcp/${s.id}/disconnect`, { body: {} }), "تم قطع الاتصال").then(() => reload())}>قطع</button>
              ) : (
                <button className="btn-primary px-3 py-1.5" disabled={pending === `p-${p.key}`} onClick={() => connect(s ? { serverId: s.id } : { preset: p.key }, `p-${p.key}`)}>{pending === `p-${p.key}` ? "…" : "ربط"}</button>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- Custom */}
      <div className="card mb-6 p-4">
        <div className="mb-2 font-medium">موصّل مخصص</div>
        <p className="mb-3 text-xs text-slate-500">الصق رابط أي خادم MCP أو إعداداته (JSON) واضغط «ربط» — يفتح لك صفحة الخدمة تسجّل دخول وترجع مربوط. بدون أي توكن.</p>
        <AddConnector back="/admin/mcp" />
      </div>

      {/* ---------------- All servers */}
      <h2 className="mb-2 text-sm font-semibold text-slate-300">كل الموصّلات</h2>
      <Table head={["الموصّل", "الحالة", "الأدوات", ""]} empty={data?.servers.length === 0}>
        {data?.servers.map((s) => {
          const on = isConnected(s);
          return (
            <tr key={s.id} className="align-top">
              <td className="px-3 py-3">
                <div className="font-medium">{s.name}</div>
                <div dir="ltr" className="max-w-[260px] break-all text-start text-xs text-slate-500">{s.url}</div>
                <div className="mt-1 flex gap-1"><OnOff on={s.enabled} /><span className="badge bg-slate-500/15 text-slate-400">{authLabel(s)}</span></div>
              </td>
              <td className="px-3 py-3 text-xs">
                {on ? <span className="text-emerald-300">مربوط{s.connectedAs ? <> كـ <b dir="ltr">{s.connectedAs}</b></> : ""}{s.connectedAt ? ` · ${fmtDate(s.connectedAt, true)}` : ""}</span> : <span className="text-amber-300">يحتاج ربط</span>}
                {s.lastError && <div className="mt-1 max-w-[260px] text-amber-300/90">{s.lastError}</div>}
              </td>
              <td className="px-3 py-3 text-xs text-slate-400">
                <button className="underline decoration-dotted" onClick={() => setOpenTools(openTools === s.id ? null : s.id)}>{s.toolCount} أداة</button>
                {openTools === s.id && (
                  <ul dir="ltr" className="mt-2 max-h-64 max-w-[320px] space-y-1 overflow-auto text-start">
                    {s.tools.map((t) => <li key={t.name}><span className="font-mono text-slate-200">{t.name}</span> <span className="text-slate-500">{t.description}</span></li>)}
                  </ul>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {s.authType !== "github" && <button className="btn-outline px-2.5 py-1.5" disabled={pending === `conn-${s.id}`} onClick={() => connect({ serverId: s.id }, `conn-${s.id}`)}><Link2 size={14} /> {on ? "إعادة ربط" : "ربط"}</button>}
                  <button className="btn-outline px-2.5 py-1.5" disabled={busy === `sync-${s.id}`} onClick={() => run(`sync-${s.id}`, () => api<{ ok: boolean; error?: string; server: Server }>(`/api/admin/mcp/${s.id}/sync`, { method: "POST" }), (r) => (r.ok ? `شغال: ${r.server.toolCount} أداة` : `فشل: ${r.error}`)).then(() => reload())}><RefreshCw size={14} /> اختبار</button>
                  {on && (s.authType === "oauth" || s.authType === "token") && <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`dis-${s.id}`, () => api(`/api/admin/mcp/${s.id}/disconnect`, { body: {} }), "تم قطع الاتصال").then(() => reload())}><Unlink size={14} /> قطع</button>}
                  <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`en-${s.id}`, () => api(`/api/admin/mcp/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }), s.enabled ? "تم التعطيل" : "تم التفعيل").then(() => reload())}>{s.enabled ? "تعطيل" : "تفعيل"}</button>
                  <button className="btn-ghost px-2 py-1.5 text-slate-400" onClick={() => openEdit(s)} title="إعدادات متقدمة">متقدم</button>
                  <button className="btn-ghost px-2 py-1.5 text-red-300" aria-label="حذف" onClick={() => confirm(`حذف ${s.name}؟`) && run("del", () => api(`/api/admin/mcp/${s.id}`, { method: "DELETE" }), "تم الحذف").then(() => reload())}><Trash2 size={15} /></button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>

      <section className="card mt-6">
        <h2 className="mb-1 font-semibold">سجل الربط</h2>
        <p className="mb-3 text-xs text-slate-400">كل ضغطة «ربط» ورجوع من المزوّد تنسجل هنا — لو فشل شي تشوف السبب.</p>
        {!data?.events?.length ? (
          <p className="text-sm text-slate-500">ما فيه محاولات بعد.</p>
        ) : (
          <ul className="divide-y divide-ink-700 text-sm" data-testid="connect-log">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{e.kind === "github" ? "GitHub" : e.target ?? "MCP"}</span>
                    <span className="badge bg-ink-700 text-slate-300">{({ start: "بدء", callback: "رجوع من المزوّد", done: "تم", error: "خطأ", app_created: "إنشاء التطبيق" } as Record<string, string>)[e.step] ?? e.step}</span>
                    <span className="text-xs text-slate-500">{fmtDate(e.createdAt)}</span>
                  </div>
                  {e.message && <div dir="auto" className={`break-words text-xs ${e.ok ? "text-slate-400" : "text-rose-300"}`}>{e.message}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal open={!!form} onClose={() => setForm(null)} title={`إعدادات متقدمة — ${editing?.name ?? ""}`} wide>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-xs text-slate-500 sm:col-span-2">ما تحتاج هذي عادةً — زر «ربط» يكفي. استخدم التوكن فقط لخادم ما يدعم تسجيل الدخول (OAuth).</p>
            <Field label="الاسم"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="المعرّف (slug)"><input dir="ltr" className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="الرابط"><input dir="ltr" className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <Field label="النقل">
              <select className="input" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="auto">تلقائي</option>
                <option value="streamable">Streamable HTTP</option>
                <option value="sse">SSE (قديم)</option>
              </select>
            </Field>
            <Field label="فلتر الأدوات" hint="أسماء مفصولة بفاصلة، ويدعم * — فارغ = الكل"><input dir="ltr" className="input font-mono text-xs" value={form.toolFilter} onChange={(e) => setForm({ ...form, toolFilter: e.target.value })} /></Field>
            <Field label="ترويسات إضافية (JSON)"><input dir="ltr" className="input font-mono text-xs" value={form.extraHeaders} onChange={(e) => setForm({ ...form, extraHeaders: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="مفعّل" /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>إلغاء</button>
              <button className="btn-primary" disabled={busy === "save"} onClick={saveAdvanced}>{busy === "save" ? "جارٍ الحفظ…" : "حفظ"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
