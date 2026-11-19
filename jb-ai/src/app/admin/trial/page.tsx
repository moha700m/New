"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Toggle } from "@/components/ui/Toggle";

interface S {
  enabled: boolean;
  requireVerification: boolean;
  messages: number;
  dailyCapUsd: number;
  maxOutputTokens: number;
  historyMessages: number;
  maxInputChars: number;
  models: string[];
  labels: Record<string, { name: string; desc: string }>;
  listTitle: string;
  priceUsd: number;
  creditLabel: string;
  telegramUrl: string;
}
interface U { id: string; email: string; name: string | null; access: string; trialUsed: number; emailVerifiedAt: string | null; disabled: boolean; createdAt: string; signupIp: string | null; spentUsd: number }
interface M { id: string; modelId: string; displayName: string; inputPricePerM: number | null; outputPricePerM: number | null }
interface D { settings: S; mailerConfigured: boolean; today: { spendUsd: number; requests: number; capUsd: number }; users: U[]; models: M[] }

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default function TrialAdminPage() {
  const { data, reload } = useAdmin<D>("/api/admin/trial");
  const { run, busy } = useAction();
  const [s, setS] = useState<S | null>(null);
  const [nu, setNu] = useState({ email: "", password: "", access: "trial" });
  useEffect(() => setS(data?.settings ?? null), [data]);
  if (!data || !s) return <p className="text-slate-400">جارٍ التحميل…</p>;
  const pct = Math.min(100, (data.today.spendUsd / Math.max(data.today.capUsd, 0.0001)) * 100);
  const act = (u: U, action: string, msg: string) => run(`${u.id}:${action}`, () => api(`/api/admin/trial/users/${u.id}`, { body: { action } }), msg).then(() => reload());
  const trialUsers = data.users.filter((u) => u.access === "trial");
  const fullUsers = data.users.filter((u) => u.access === "full");
  return (
    <>
      <PageHeader
        title="التجربة المجانية"
        subtitle="تسجيل عام للتجربة فقط — الموقع يبقى خاص لك. نماذج رخيصة بدون فلترة، عدد رسائل محدود، وسقف صرف يومي."
        actions={<button className="btn-primary" disabled={busy === "s"} onClick={() => run("s", () => api("/api/admin/trial", { method: "PUT", body: s }), "تم الحفظ").then(() => reload())} data-testid="trial-save">حفظ</button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3" data-testid="trial-spend">
          <h2 className="font-semibold">صرف التجربة اليوم (توقيت الرياض)</h2>
          <div className="text-3xl font-bold">{usd(data.today.spendUsd)} <span className="text-base font-normal text-slate-400">/ {usd(data.today.capUsd)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-700"><div className={`h-full ${pct >= 100 ? "bg-rose-500" : pct > 70 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>
          <p className="text-sm text-slate-400">{data.today.requests} طلب اليوم · {pct >= 100 ? "وصل السقف — التجربة متوقفة لين بكرة" : "تحت السقف"}</p>
          <div className="flex flex-wrap gap-2 pt-1 text-sm">
            <span>التجربة: <OnOff on={s.enabled} onLabel="شغّالة" offLabel="مقفلة" /></span>
            <span>البريد (SMTP): <OnOff on={data.mailerConfigured} onLabel="مُعدّ" offLabel="غير مُعدّ" /></span>
          </div>
          {s.enabled && s.requireVerification && !data.mailerConfigured && (
            <p className="rounded-lg bg-amber-500/10 p-2 text-xs leading-6 text-amber-200">التسجيل متوقف لأن البريد غير مُعدّ (رابط التأكيد ما يقدر يوصل). أضف SMTP_URL في Vercel، أو أطفئ «اشتراط تأكيد الإيميل» على مسؤوليتك.</p>
          )}
        </div>
        <div className="card space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="تشغيل التجربة المجانية" hint="يفتح التسجيل للتجربة فقط" />
            <Toggle checked={s.requireVerification} onChange={(v) => setS({ ...s, requireVerification: v })} label="اشتراط تأكيد الإيميل" hint={data.mailerConfigured ? undefined : "يحتاج SMTP"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="رسائل لكل حساب"><input className="input" type="number" value={s.messages} onChange={(e) => setS({ ...s, messages: Number(e.target.value) })} /></Field>
            <Field label="سقف الصرف اليومي ($)"><input className="input" type="number" step="0.1" value={s.dailyCapUsd} onChange={(e) => setS({ ...s, dailyCapUsd: Number(e.target.value) })} /></Field>
            <Field label="أقصى توكنز للرد"><input className="input" type="number" value={s.maxOutputTokens} onChange={(e) => setS({ ...s, maxOutputTokens: Number(e.target.value) })} /></Field>
          </div>
          <h3 className="pt-2 font-semibold">إعلان الاشتراك</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="سعر الاشتراك ($)"><input className="input" type="number" value={s.priceUsd} onChange={(e) => setS({ ...s, priceUsd: Number(e.target.value) })} data-testid="trial-price-input" /></Field>
            <Field label="الرصيد (يظهر في الإعلان)"><input className="input" value={s.creditLabel} onChange={(e) => setS({ ...s, creditLabel: e.target.value })} /></Field>
            <Field label="رابط تلقرام"><input dir="ltr" className="input" value={s.telegramUrl} onChange={(e) => setS({ ...s, telegramUrl: e.target.value })} /></Field>
          </div>
          <Field label="عنوان قائمة النماذج"><input className="input" value={s.listTitle} onChange={(e) => setS({ ...s, listTitle: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card mt-4 space-y-2">
        <h2 className="font-semibold">نماذج التجربة (Venice بدون فلترة — الأرخص أول)</h2>
        <p className="text-xs text-slate-500">الأسماء والوصف هي اللي يشوفها الضيف — الاسم الحقيقي يبقى مخفي.</p>
        <div className="divide-y divide-ink-700">
          {data.models.map((m) => {
            const on = s.models.includes(m.modelId);
            const l = s.labels[m.modelId] ?? { name: "", desc: "" };
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                <Toggle checked={on} onChange={(v) => setS({ ...s, models: v ? [...s.models, m.modelId] : s.models.filter((x) => x !== m.modelId) })} />
                <div className="min-w-[180px] flex-1">
                  <div className="text-sm font-medium">{m.displayName}</div>
                  <div className="text-xs text-slate-500" dir="ltr">${m.inputPricePerM ?? "?"} in / ${m.outputPricePerM ?? "?"} out per 1M</div>
                </div>
                {on && (
                  <>
                    <input className="input w-32" placeholder="الاسم بالسعودي" value={l.name} onChange={(e) => setS({ ...s, labels: { ...s.labels, [m.modelId]: { ...l, name: e.target.value } } })} />
                    <input className="input min-w-[200px] flex-1" placeholder="وصف قصير" value={l.desc} onChange={(e) => setS({ ...s, labels: { ...s.labels, [m.modelId]: { ...l, desc: e.target.value } } })} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card mt-4 space-y-3">
        <h2 className="font-semibold">إضافة حساب يدوي</h2>
        <p className="text-xs text-slate-500">ينشأ مؤكّد على طول (ما يحتاج إيميل تأكيد) — مفيد لين ما تجهّز SMTP، أو لمشترك دفع لك.</p>
        <div className="flex flex-wrap items-end gap-2">
          <input dir="ltr" className="input w-64" placeholder="email@example.com" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <input dir="ltr" className="input w-48" type="password" autoComplete="new-password" placeholder="كلمة سر (٨+)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <select className="input w-40" value={nu.access} onChange={(e) => setNu({ ...nu, access: e.target.value })}>
            <option value="trial">تجربة</option>
            <option value="full">اشتراك كامل</option>
          </select>
          <button className="btn-primary" disabled={busy === "new" || !nu.email || nu.password.length < 8} onClick={() => run("new", () => api("/api/admin/trial/users", { body: nu }), "تم إنشاء الحساب").then((r) => { if (r) { setNu({ email: "", password: "", access: "trial" }); void reload(); } })}>إضافة</button>
        </div>
      </div>

      <div className="mt-4 space-y-2" data-testid="trial-users">
        <h2 className="font-semibold">حسابات التجربة ({trialUsers.length}) · المشتركين ({fullUsers.length})</h2>
        <Table head={["الإيميل", "النوع", "الرسائل", "الصرف", "مؤكّد", "التسجيل", "إجراءات"]} empty={!data.users.length}>
          {data.users.map((u) => (
            <tr key={u.id} className={u.disabled ? "opacity-50" : ""}>
              <td className="px-3 py-2"><bdi dir="ltr">{u.email}</bdi></td>
              <td className="px-3 py-2">{u.access === "full" ? <span className="badge bg-amber-500/15 text-amber-300">مشترك</span> : <span className="badge bg-ink-700 text-slate-300">تجربة</span>}</td>
              <td className="px-3 py-2">{u.access === "full" ? "∞" : `${u.trialUsed} / ${s.messages}`}</td>
              <td className="px-3 py-2" dir="ltr">{usd(u.spentUsd)}</td>
              <td className="px-3 py-2">{u.emailVerifiedAt ? "✓" : "—"}</td>
              <td className="px-3 py-2 text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" })}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {u.access === "trial" ? (
                    <button className="btn-primary px-2 py-1 text-xs" onClick={() => act(u, "full", "تمت الترقية للاشتراك الكامل")} data-testid="trial-upgrade">ترقية لاشتراك كامل</button>
                  ) : (
                    <button className="btn-outline px-2 py-1 text-xs" onClick={() => act(u, "trial", "رجع للتجربة")}>إرجاع للتجربة</button>
                  )}
                  {u.access === "trial" && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(u, "reset", "تم تصفير الرسائل")}>تصفير</button>}
                  {!u.emailVerifiedAt && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(u, "verify", "تم التأكيد")}>تأكيد يدوي</button>}
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(u, u.disabled ? "enable" : "disable", u.disabled ? "تم التفعيل" : "تم الإيقاف")}>{u.disabled ? "تفعيل" : "إيقاف"}</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-rose-300" onClick={() => confirm(`حذف ${u.email}؟`) && act(u, "delete", "تم الحذف")}>حذف</button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  );
}
