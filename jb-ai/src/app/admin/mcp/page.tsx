"use client";
import { CheckCircle2, ChevronDown, ExternalLink, Github, Link2, Plug, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

type Server = {
  id: string; slug: string; name: string; url: string; transport: string; authHeader: string; authScheme: string; authType: string;
  hasToken: boolean; tokenLast4: string | null; extraHeaders: Record<string, string> | null; enabled: boolean; toolFilter: string | null;
  toolCount: number; tools: { name: string; description: string }[]; lastSyncAt: string | null; lastError: string | null;
  connectedAt: string | null; connectedAs: string | null; oauthIssuer: string | null; tokenExpiresAt: string | null;
};
type Preset = { key: string; name: string; url: string; desc: string };
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
  const { data, reload } = useAdmin<{ servers: Server[]; presets: Preset[]; github: GithubState }>("/api/admin/mcp");
  const { run, busy } = useAction();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [custom, setCustom] = useState({ name: "", url: "" });
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<Server | null>(null);
  const [openTools, setOpenTools] = useState<string | null>(null);
  const gh = data?.github;
  const bySlug = new Map((data?.servers ?? []).map((s) => [s.slug, s]));

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) setFlash({ ok: true, text: `تم الربط ✓ ${q.get("connected") === "github" ? "GitHub" : q.get("connected")}${q.get("tools") ? ` — ${q.get("tools")} أداة` : ""}` });
    else if (q.get("error")) setFlash({ ok: false, text: q.get("error")! });
    else if (q.get("github") === "installed") setFlash({ ok: true, text: "تم تثبيت تطبيق GitHub. اضغط «ربط الحساب» لإكمال الربط." });
    if (q.toString()) window.history.replaceState(null, "", "/admin/mcp");
  }, []);

  async function connect(body: { serverId?: string; preset?: string }, key: string) {
    const r = await run(key, () => api<{ connected: boolean; authorizeUrl?: string; server?: Server }>("/api/admin/mcp/connect", { body }));
    if (r?.authorizeUrl) window.location.href = r.authorizeUrl;
    else if (r?.connected) {
      setFlash({ ok: true, text: `تم الربط ✓ ${r.server?.name} — ${r.server?.toolCount} أداة (ما يحتاج تسجيل دخول)` });
      void reload();
    } else void reload();
  }

  async function githubCreateApp() {
    const r = await run("gh-app", () => api<{ action: string; manifest: string }>("/api/admin/github/manifest", { body: {} }));
    if (!r) return;
    const f = document.createElement("form");
    f.method = "post";
    f.action = r.action;
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = "manifest";
    i.value = r.manifest;
    f.appendChild(i);
    document.body.appendChild(f);
    f.submit();
  }

  async function githubConnect() {
    const r = await run("gh-conn", () => api<{ authorizeUrl: string }>("/api/admin/github/connect", { body: {} }));
    if (r?.authorizeUrl) window.location.href = r.authorizeUrl;
  }

  async function addCustom() {
    const slug = custom.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 31) || `mcp-${Date.now().toString(36)}`;
    const r = await run("add", () => api<{ server: Server }>("/api/admin/mcp", { body: { name: custom.name || slug, slug, url: custom.url.trim(), transport: "auto" } }));
    if (!r) return;
    setCustom({ name: "", url: "" });
    await reload();
    await connect({ serverId: r.server.id }, `conn-${r.server.id}`);
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
            <button className="btn-primary" disabled={!data || busy === "gh-app"} onClick={githubCreateApp} data-testid="github-connect"><Github size={15} /> {busy === "gh-app" ? "جارٍ التحويل لـ GitHub…" : "ربط GitHub"}</button>
          )}
          {gh?.appCreated && !gh.connected && (
            <>
              <button className="btn-primary" disabled={busy === "gh-conn"} onClick={githubConnect}><Link2 size={15} /> ربط الحساب</button>
              {gh.installUrl && <a className="btn-outline" href={gh.installUrl}><ExternalLink size={14} /> تثبيت على المستودعات</a>}
            </>
          )}
          {gh?.connected && (
            <>
              {gh.installUrl && <a className="btn-outline px-2.5 py-1.5" href={gh.installUrl}><ExternalLink size={14} /> اختيار المستودعات</a>}
              <button className="btn-outline px-2.5 py-1.5" disabled={busy === "gh-conn"} onClick={githubConnect}><RefreshCw size={14} /> إعادة الربط</button>
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
                <button className="btn-primary px-3 py-1.5" disabled={busy === `p-${p.key}`} onClick={() => connect(s ? { serverId: s.id } : { preset: p.key }, `p-${p.key}`)}>{busy === `p-${p.key}` ? "…" : "ربط"}</button>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- Custom */}
      <div className="card mb-6 p-4">
        <div className="mb-2 font-medium">موصّل مخصص</div>
        <p className="mb-3 text-xs text-slate-500">الصق رابط أي خادم MCP واضغط «ربط». إذا يحتاج تسجيل دخول يفتح لك صفحة الخدمة (OAuth)، وإذا ما يحتاج يتربط على طول.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input className="input" placeholder="الاسم" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          <input dir="ltr" className="input" placeholder="https://example.com/mcp" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
          <button className="btn-primary" disabled={!custom.url.trim() || busy === "add"} onClick={addCustom}><Plus size={15} /> ربط</button>
        </div>
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
                  {s.authType !== "github" && <button className="btn-outline px-2.5 py-1.5" disabled={busy === `conn-${s.id}`} onClick={() => connect({ serverId: s.id }, `conn-${s.id}`)}><Link2 size={14} /> {on ? "إعادة ربط" : "ربط"}</button>}
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
            <details className="sm:col-span-2">
              <summary className="cursor-pointer text-sm text-slate-400"><ChevronDown size={13} className="inline" /> توكن يدوي (بديل احتياطي)</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="التوكن" hint="يُشفَّر ولا يُعرض مرة ثانية."><input dir="ltr" className="input font-mono" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></Field>
                <Field label="ترويسة المصادقة"><input dir="ltr" className="input" value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} /></Field>
                <Field label="نوع المصادقة"><input dir="ltr" className="input" value={form.authScheme} onChange={(e) => setForm({ ...form, authScheme: e.target.value })} /></Field>
              </div>
            </details>
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
