"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { api, fmtNum, money } from "@/components/api";
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
    const ok = await run("save", () => (id ? api(`/api/admin/plans/${id}`, { method: "PUT", body }) : api("/api/admin/plans", { body })), "تم حفظ الباقة — تُطبَّق الحدود وصلاحيات النماذج فورًا");
    if (ok) { setD(null); void reload(); }
  }

  return (
    <>
      <PageHeader title="باقات الاشتراك" subtitle="الأسعار، وحدود الاستخدام، والمزايا، والنماذج المتاحة لكل باقة. صفحة الدفع تستخدم هذه الأسعار مباشرة." actions={<button className="btn-primary" onClick={() => setD({ ...empty })}><Plus size={16} /> باقة جديدة</button>} />
      <div className="grid gap-4 md:grid-cols-3">
        {data?.plans.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{p.name}</h3><p className="text-xs text-slate-500"><bdi dir="ltr">{p.key}</bdi>{p.isDefault && " · الباقة الافتراضية (المجانية)"}</p></div>
              <OnOff on={p.active} onLabel="نشطة" offLabel="غير نشطة" />
            </div>
            <p className="mt-2 text-sm"><bdi>{money(p.priceMonthlyCents, p.currency)}</bdi> شهريًا · <bdi>{money(p.priceYearlyCents, p.currency)}</bdi> سنويًا</p>
            <ul className="mt-3 space-y-1 text-xs text-slate-400">
              <li>الرسائل اليومية: {p.dailyMessageLimit ?? "بدون حد"}</li>
              <li>الرسائل الشهرية: {p.monthlyMessageLimit ?? "بدون حد"}</li>
              <li>التوكنز الشهرية: {p.monthlyTokenLimit != null ? fmtNum(p.monthlyTokenLimit) : "بدون حد"}</li>
              <li>رفع الملفات: {p.allowUploads ? `حتى ${p.maxUploadMb} ميجابايت` : "لا"} · البحث في الويب: {p.allowWebSearch ? "نعم" : "لا"} · توليد الصور: {p.allowImageGeneration ? "نعم" : "لا"}</li>
              <li>النماذج: {p.allowAllModels ? "كل النماذج المفعّلة" : `${p.modelIds.length} نموذج محدد`}</li>
              <li>المشتركون: {p.subscriberCount}</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <button className="btn-outline px-3 py-1.5" onClick={() => setD({ ...p, featuresText: (p.features ?? []).join("\n") })}>تعديل</button>
              {!p.isDefault && <button className="btn-ghost px-3 py-1.5 text-red-300" onClick={() => confirm(`حذف باقة ${p.name}؟`) && run("del", () => api(`/api/admin/plans/${p.id}`, { method: "DELETE" }), "تم حذف الباقة").then(() => reload())}>حذف</button>}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!d} onClose={() => setD(null)} title={d?.id ? `تعديل ${d.name}` : "باقة جديدة"} wide>
        {d && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المعرّف"><input dir="ltr" className="input" value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })} /></Field>
            <Field label="الاسم"><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="الوصف"><input className="input" value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field></div>
            <Field label="السعر الشهري (بالسنت)"><input className="input" type="number" value={d.priceMonthlyCents} onChange={(e) => setD({ ...d, priceMonthlyCents: Number(e.target.value) })} /></Field>
            <Field label="السعر السنوي (بالسنت)"><input className="input" type="number" value={d.priceYearlyCents} onChange={(e) => setD({ ...d, priceYearlyCents: Number(e.target.value) })} /></Field>
            <Field label="العملة"><input dir="ltr" className="input" value={d.currency} maxLength={3} onChange={(e) => setD({ ...d, currency: e.target.value.toLowerCase() })} /></Field>
            <Field label="ترتيب العرض"><input className="input" type="number" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: Number(e.target.value) })} /></Field>
            <Field label="حد الرسائل اليومي" hint="فارغ = بدون حد"><input className="input" type="number" value={d.dailyMessageLimit ?? ""} onChange={(e) => setD({ ...d, dailyMessageLimit: num(e.target.value) })} /></Field>
            <Field label="حد الرسائل الشهري" hint="فارغ = بدون حد"><input className="input" type="number" value={d.monthlyMessageLimit ?? ""} onChange={(e) => setD({ ...d, monthlyMessageLimit: num(e.target.value) })} /></Field>
            <Field label="حد التوكنز الشهري" hint="فارغ = بدون حد"><input className="input" type="number" value={d.monthlyTokenLimit ?? ""} onChange={(e) => setD({ ...d, monthlyTokenLimit: num(e.target.value) })} /></Field>
            <Field label="أقصى حجم ملف (ميجابايت)"><input className="input" type="number" value={d.maxUploadMb} onChange={(e) => setD({ ...d, maxUploadMb: Number(e.target.value) })} /></Field>
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
              <Toggle checked={d.allowUploads} onChange={(v) => setD({ ...d, allowUploads: v })} label="رفع الملفات" />
              <Toggle checked={d.allowWebSearch} onChange={(v) => setD({ ...d, allowWebSearch: v })} label="البحث في الويب" />
              <Toggle checked={d.allowImageGeneration} onChange={(v) => setD({ ...d, allowImageGeneration: v })} label="توليد الصور" />
              <Toggle checked={d.allowAllModels} onChange={(v) => setD({ ...d, allowAllModels: v })} label="كل النماذج" />
              <Toggle checked={Boolean(d.isDefault)} onChange={(v) => setD({ ...d, isDefault: v })} label="الباقة الافتراضية (المجانية)" />
              <Toggle checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="نشطة" />
            </div>
            <div className="sm:col-span-2"><Field label="المزايا (ميزة في كل سطر، تظهر في صفحة الأسعار)"><textarea dir="auto" className="input min-h-[90px]" value={d.featuresText} onChange={(e) => setD({ ...d, featuresText: e.target.value })} /></Field></div>
            {!d.allowAllModels && (
              <div className="sm:col-span-2">
                <p className="label">النماذج المتاحة في هذه الباقة ({d.modelIds.length})</p>
                <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-ink-600 p-3 sm:grid-cols-2">
                  {models.data?.models.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={d.modelIds.includes(m.id)} onChange={(e) => setD({ ...d, modelIds: e.target.checked ? [...d.modelIds, m.id] : d.modelIds.filter((x) => x !== m.id) })} />
                      <span className="truncate">{m.displayName}</span><span className="text-xs text-slate-500">{m.provider.name}</span>
                    </label>
                  ))}
                  {!models.data?.models.length && <p className="text-sm text-slate-500">فعّل النماذج أولًا من صفحة إدارة النماذج.</p>}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setD(null)}>إلغاء</button>
              <button className="btn-primary" disabled={busy === "save"} onClick={save}>حفظ الباقة</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
