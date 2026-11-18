"use client";
import { Github, KeyRound, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, fmtDate } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

type Server = {
  id: string; slug: string; name: string; url: string; transport: string; authHeader: string; authScheme: string;
  hasToken: boolean; tokenLast4: string | null; extraHeaders: Record<string, string> | null; enabled: boolean; toolFilter: string | null;
  toolCount: number; tools: { name: string; description: string }[]; lastSyncAt: string | null; lastError: string | null;
};
type Preset = { name: string; slug: string; url: string; transport: string; authHeader: string; authScheme: string; extraHeaders: Record<string, string> };

const blank = { name: "", slug: "", url: "", transport: "auto", authHeader: "Authorization", authScheme: "Bearer", token: "", extraHeaders: "", toolFilter: "", enabled: true };

export default function McpPage() {
  const { data, reload } = useAdmin<{ servers: Server[]; presets: { github: Preset } }>("/api/admin/mcp");
  const { run, busy } = useAction();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<Server | null>(null);
  const [tokenFor, setTokenFor] = useState<Server | null>(null);
  const [newToken, setNewToken] = useState("");
  const [openTools, setOpenTools] = useState<string | null>(null);
  const github = data?.servers.find((s) => s.slug === "github");

  function openNew(preset?: Preset) {
    setEditing(null);
    setForm(preset ? { ...blank, ...preset, extraHeaders: JSON.stringify(preset.extraHeaders), token: "" } : { ...blank });
  }
  function openEdit(s: Server) {
    setEditing(s);
    setForm({ name: s.name, slug: s.slug, url: s.url, transport: s.transport, authHeader: s.authHeader, authScheme: s.authScheme, token: "", extraHeaders: s.extraHeaders ? JSON.stringify(s.extraHeaders) : "", toolFilter: s.toolFilter ?? "", enabled: s.enabled });
  }

  async function sync(id: string) {
    const r = await run(`sync-${id}`, () => api<{ ok: boolean; error?: string; server: Server }>(`/api/admin/mcp/${id}/sync`, { method: "POST" }), (r) => (r.ok ? `تم الاتصال: ${r.server.toolCount} أداة` : `فشل الاتصال: ${r.error}`));
    void reload();
    return r;
  }

  async function save() {
    if (!form) return;
    let extra: Record<string, string> | undefined;
    if (form.extraHeaders.trim()) {
      try {
        extra = JSON.parse(form.extraHeaders);
      } catch {
        return alert('الترويسات الإضافية لازم تكون JSON صحيح، مثل {"X-MCP-Toolsets":"repos,issues"}');
      }
    }
    const body = { name: form.name, slug: form.slug, url: form.url, transport: form.transport, authHeader: form.authHeader, authScheme: form.authScheme, extraHeaders: extra, toolFilter: form.toolFilter || null, enabled: form.enabled, ...(form.token.trim() ? { token: form.token.trim() } : {}) };
    const r = await run("save", () => (editing ? api<{ server: Server }>(`/api/admin/mcp/${editing.id}`, { method: "PATCH", body }) : api<{ server: Server }>("/api/admin/mcp", { body })), editing ? "تم تحديث الخادم" : "تمت إضافة الخادم");
    if (r) {
      setForm(null);
      await reload();
      void sync(r.server.id);
    }
  }

  return (
    <>
      <PageHeader
        title="خوادم MCP والأدوات"
        subtitle="الأدوات اللي يستخدمها وضع الوكيل في المحادثة. المفاتيح تُشفَّر (AES-256-GCM) ولا تُعرض مرة ثانية."
        actions={<button className="btn-primary" onClick={() => openNew()}><Plus size={16} /> إضافة خادم MCP</button>}
      />

      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 font-medium"><Github size={18} /> ربط GitHub</div>
          {github ? (
            <p className="text-sm text-slate-400">
              GitHub مربوط {github.hasToken ? <span dir="ltr" className="font-mono">(••••{github.tokenLast4})</span> : <span className="text-amber-300">(بدون توكن)</span>} · {github.toolCount} أداة.
              {github.lastError && <span className="block text-amber-300">{github.lastError}</span>}
            </p>
          ) : (
            <ol className="list-decimal space-y-1 ps-5 text-sm text-slate-400">
              <li>افتح <a className="text-sky-300 underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com/settings/personal-access-tokens/new</a> وسوِّ توكن (Fine-grained).</li>
              <li>اختر المستودعات، وأعطه صلاحيات: Contents و Pull requests و Issues (Read and write)، و Metadata (Read).</li>
              <li>اضغط الزر تحت، الصق التوكن، واحفظ. الأدوات تتحمّل تلقائيًا.</li>
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {github ? (
              <>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => { setTokenFor(github); setNewToken(""); }}><KeyRound size={14} /> {github.hasToken ? "تغيير التوكن" : "إضافة توكن"}</button>
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `sync-${github.id}`} onClick={() => sync(github.id)}><RefreshCw size={14} /> اختبار وتحديث الأدوات</button>
              </>
            ) : (
              <button className="btn-primary" disabled={!data} onClick={() => data && openNew(data.presets.github)}><Github size={15} /> ربط GitHub</button>
            )}
          </div>
        </div>
        <div className="card p-4 text-sm text-slate-400">
          <div className="mb-2 flex items-center gap-2 font-medium text-slate-200"><Plug size={18} /> أدوات مدمجة (شغالة دائمًا)</div>
          <ul className="list-disc space-y-1 ps-5">
            <li><b>web_search</b>: بحث في الويب.</li>
            <li><b>web_fetch</b>: قراءة أي صفحة أو API عام.</li>
            <li><b>generate_image</b>: توليد صور بنماذج الموقع (بدون فلترة).</li>
          </ul>
          <p className="mt-2">أي خادم MCP بعنوان HTTP (Streamable HTTP أو SSE) تقدر تضيفه، مثل <span dir="ltr" className="font-mono text-xs">https://mcp.deepwiki.com/mcp</span>.</p>
        </div>
      </div>

      <Table head={["الخادم", "العنوان", "المصادقة", "الأدوات", "الحالة", ""]} empty={data?.servers.length === 0}>
        {data?.servers.map((s) => (
          <tr key={s.id} className="align-top">
            <td className="px-3 py-3">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-slate-500">{s.slug} · {s.transport}</div>
              <div className="mt-1"><OnOff on={s.enabled} /></div>
            </td>
            <td dir="ltr" className="max-w-[240px] break-all px-3 py-3 text-start text-xs text-slate-400">{s.url}</td>
            <td className="px-3 py-3 text-xs">{s.hasToken ? <span dir="ltr" className="font-mono">••••{s.tokenLast4}</span> : <span className="text-slate-500">بدون</span>}</td>
            <td className="px-3 py-3 text-xs text-slate-400">
              <button className="underline decoration-dotted" onClick={() => setOpenTools(openTools === s.id ? null : s.id)}>{s.toolCount} أداة</button>
              {s.toolFilter && <div className="text-slate-500">فلتر: <span dir="ltr">{s.toolFilter}</span></div>}
              {openTools === s.id && (
                <ul dir="ltr" className="mt-2 max-h-64 max-w-[320px] space-y-1 overflow-auto text-start">
                  {s.tools.map((t) => <li key={t.name}><span className="font-mono text-slate-200">{t.name}</span> <span className="text-slate-500">{t.description}</span></li>)}
                </ul>
              )}
            </td>
            <td className="px-3 py-3 text-xs">
              {s.lastError ? <span className="text-amber-300">{s.lastError}</span> : s.lastSyncAt ? <span className="text-emerald-300">متصل · {fmtDate(s.lastSyncAt, true)}</span> : <span className="text-slate-500">لم يُختبر</span>}
            </td>
            <td className="px-3 py-3">
              <div className="flex flex-wrap justify-end gap-1.5">
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `sync-${s.id}`} onClick={() => sync(s.id)}><RefreshCw size={14} /> {busy === `sync-${s.id}` ? "جارٍ الاتصال…" : "اختبار"}</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => { setTokenFor(s); setNewToken(""); }}><KeyRound size={14} /> التوكن</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`en-${s.id}`, () => api(`/api/admin/mcp/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }), s.enabled ? "تم التعطيل" : "تم التفعيل").then(() => reload())}>{s.enabled ? "تعطيل" : "تفعيل"}</button>
                <button className="btn-outline px-2.5 py-1.5" onClick={() => openEdit(s)}>تعديل</button>
                <button className="btn-ghost px-2 py-1.5 text-red-300" aria-label="حذف" onClick={() => confirm(`حذف ${s.name}؟`) && run("del", () => api(`/api/admin/mcp/${s.id}`, { method: "DELETE" }), "تم الحذف").then(() => reload())}><Trash2 size={15} /></button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!form} onClose={() => setForm(null)} title={editing ? `تعديل ${editing.name}` : "إضافة خادم MCP"} wide>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: editing || form.slug === "github" ? form.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 31) })} /></Field>
            <Field label="المعرّف (slug)" hint="يظهر كبادئة لأسماء الأدوات"><input dir="ltr" className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="عنوان الخادم (URL)" hint="Streamable HTTP مثل https://…/mcp أو SSE مثل https://…/sse"><input dir="ltr" className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <Field label="النقل">
              <select className="input" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="auto">تلقائي</option>
                <option value="streamable">Streamable HTTP</option>
                <option value="sse">SSE (قديم)</option>
              </select>
            </Field>
            <Field label={editing ? "التوكن (اتركه فارغ للإبقاء على الحالي)" : "التوكن (اختياري)"} hint="يُشفَّر ولا يُعرض مرة ثانية ولا يُرسل للمتصفح."><input dir="ltr" className="input font-mono" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ترويسة المصادقة"><input dir="ltr" className="input" value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} /></Field>
              <Field label="نوع المصادقة"><input dir="ltr" className="input" value={form.authScheme} onChange={(e) => setForm({ ...form, authScheme: e.target.value })} placeholder="Bearer" /></Field>
            </div>
            <Field label="ترويسات إضافية (JSON)" hint='اختياري، مثل {"X-MCP-Toolsets":"repos,issues"}'><input dir="ltr" className="input font-mono text-xs" value={form.extraHeaders} onChange={(e) => setForm({ ...form, extraHeaders: e.target.value })} /></Field>
            <Field label="فلتر الأدوات (اختياري)" hint="أسماء مفصولة بفاصلة، ويدعم * في النهاية. فارغ = كل الأدوات."><input dir="ltr" className="input font-mono text-xs" value={form.toolFilter} onChange={(e) => setForm({ ...form, toolFilter: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="مفعّل" /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>إلغاء</button>
              <button className="btn-primary" disabled={busy === "save" || !form.name || !form.slug || !form.url} onClick={save}>{busy === "save" ? "جارٍ الحفظ…" : "حفظ واختبار"}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!tokenFor} onClose={() => setTokenFor(null)} title={`التوكن — ${tokenFor?.name ?? ""}`}>
        <p className="mb-3 text-sm text-slate-400">يُشفَّر قبل الحفظ، ويُستبدل القديم.</p>
        <input dir="ltr" className="input font-mono" type="password" autoComplete="off" placeholder="الصق التوكن" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {tokenFor?.hasToken && <button className="btn-ghost text-red-300" onClick={() => run("clr", () => api(`/api/admin/mcp/${tokenFor!.id}`, { method: "PATCH", body: { clearToken: true } }), "تم حذف التوكن").then(() => { setTokenFor(null); reload(); })}>حذف التوكن</button>}
          <button className="btn-primary" disabled={!newToken.trim()} onClick={() => run("tok", () => api(`/api/admin/mcp/${tokenFor!.id}`, { method: "PATCH", body: { token: newToken.trim() } }), "تم حفظ التوكن").then(async (r) => { if (r) { const s = tokenFor!; setTokenFor(null); setNewToken(""); await reload(); void sync(s.id); } })}>حفظ واختبار</button>
        </div>
      </Modal>
    </>
  );
}
