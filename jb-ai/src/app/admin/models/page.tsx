"use client";
import { Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtNum } from "@/components/api";
import { CATEGORY_LABEL, type ModelRow, type PlanRow, type ProviderRow } from "@/components/admin/types";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

const CATS = ["TEXT", "REASONING", "CODE", "VISION", "IMAGE"] as const;
const CAPS: [keyof ModelRow, string][] = [
  ["supportsText", "توليد نصوص"], ["supportsStreaming", "بث مباشر"], ["supportsVision", "رؤية / قراءة الصور"], ["supportsTools", "استدعاء الأدوات"],
  ["supportsWebSearch", "بحث في الويب"], ["supportsReasoning", "تفكير واستدلال"], ["supportsStructuredOutput", "مخرجات منظّمة"], ["supportsImageGeneration", "توليد صور"], ["supportsCode", "مُحسّن للبرمجة"],
];

const CAP_SHORT: Record<string, string> = { supportsText: "نصوص", supportsStreaming: "بث", supportsVision: "رؤية", supportsTools: "أدوات", supportsWebSearch: "بحث ويب", supportsReasoning: "تفكير", supportsStructuredOutput: "مخرجات منظّمة", supportsImageGeneration: "صور", supportsCode: "برمجة" };

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
      ? await run("save", () => api(`/api/admin/models/${draft.id}`, { method: "PATCH", body }), "تم حفظ النموذج — يظهر التغيير للعملاء فورًا")
      : await run("save", () => api("/api/admin/models", { body: { ...body, providerId: draft.providerId } }), "تمت إضافة النموذج");
    if (r) {
      setDraft(null);
      void reload();
    }
  }

  async function bulk(action: "enable" | "disable" | "delete") {
    if (action === "delete" && !confirm(`حذف ${selected.size} نموذج؟`)) return;
    await run("bulk", () => api("/api/admin/models/bulk", { body: { ids: [...selected], action } }), `${({ enable: "تم تفعيل", disable: "تم تعطيل", delete: "تم حذف" } as Record<string, string>)[action]} ${selected.size} نموذج`);
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
        title="إدارة النماذج"
        subtitle={`${fmtNum(counts.enabled)} مفعّل من ${fmtNum(counts.total)} معروض. النماذج المتزامنة تأتي من الكتالوج المباشر لكل مزوّد، وأي تغيير يصل للعملاء فورًا.`}
        actions={
          <>
            {providerId && <button className="btn-outline" disabled={busy === "sync"} onClick={() => run("sync", () => api<{ result: { discovered: number; created: number; removedFromCatalog: number } }>(`/api/admin/providers/${providerId}/sync`, { method: "POST" }), (r) => `تم اكتشاف ${r.result.discovered}؛ ${r.result.created} جديد؛ ${r.result.removedFromCatalog} لم يعد متاحًا`).then(() => reload())}><RefreshCw size={15} /> {busy === "sync" ? "جارٍ المزامنة…" : "مزامنة من المزوّد"}</button>}
            <button className="btn-primary" onClick={() => setDraft({ providerId: providerId || providers.data?.providers[0]?.id, category: "TEXT", enabled: true, supportsText: true, supportsStreaming: true, sortOrder: 100, planKeys: [] })}><Plus size={16} /> إضافة نموذج يدويًا</button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-auto" value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="المزوّد">
          <option value="">كل المزوّدين</option>
          {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          <option value="all">كل الحالات</option><option value="enabled">مفعّل</option><option value="disabled">معطّل</option>
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="الفئة">
          <option value="">كل الفئات</option>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="input min-w-[160px]" placeholder="ابحث بمعرّف النموذج أو اسمه" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-outline"><Search size={15} /></button>
        </form>
      </div>
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-sm">
          تم تحديد {selected.size}
          <button className="btn-outline px-2.5 py-1" onClick={() => bulk("enable")}>تفعيل</button>
          <button className="btn-outline px-2.5 py-1" onClick={() => bulk("disable")}>تعطيل</button>
          <button className="btn-outline px-2.5 py-1 text-red-300" onClick={() => bulk("delete")}>حذف</button>
          <button className="btn-ghost px-2.5 py-1" onClick={() => setSelected(new Set())}>إلغاء التحديد</button>
        </div>
      )}
      <Table head={[<input key="a" type="checkbox" aria-label="تحديد الكل" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(models.map((m) => m.id)))} />, "النموذج", "المزوّد", "الفئة", "القدرات", "السعر / السياق", "الباقات", "الحالة", ""]} empty={data?.models.length === 0}>
        {models.map((m) => (
          <tr key={m.id} className={`align-top ${!m.inCatalog ? "opacity-60" : ""}`}>
            <td className="px-3 py-3"><input type="checkbox" aria-label={`تحديد ${m.displayName}`} checked={selected.has(m.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} /></td>
            <td className="max-w-[260px] px-3 py-3">
              <div className="font-medium">{m.displayName}</div>
              <div dir="ltr" className="break-all text-start font-mono text-xs text-slate-500">{m.modelId}</div>
              {tests[m.id] && <div className={`mt-1 text-xs ${tests[m.id]!.ok ? "text-emerald-300" : "text-red-300"}`}><bdi>{tests[m.id]!.ok ? `✓ ${tests[m.id]!.latencyMs}ms: ${tests[m.id]!.output.slice(0, 80)}` : `✗ ${tests[m.id]!.error}`}</bdi></div>}
            </td>
            <td className="px-3 py-3 text-xs">{m.provider.name}<div className="text-slate-500">{m.source === "MANUAL" ? "يدوي" : "متزامن"}{!m.inCatalog && " · غير موجود في الكتالوج المباشر"}{m.offline && " · غير متصل"}</div></td>
            <td className="px-3 py-3 text-xs">{CATEGORY_LABEL[m.category]}</td>
            <td className="px-3 py-3 text-[11px] text-slate-400">{CAPS.filter(([k]) => m[k]).map(([k]) => CAP_SHORT[k as string]).join("، ")}</td>
            <td className="px-3 py-3 text-xs text-slate-400">{m.inputPricePerM != null ? <bdi dir="ltr">{`$${m.inputPricePerM} / $${m.outputPricePerM}`}</bdi> : "—"}{m.inputPricePerM != null && " لكل مليون"}<div>{m.contextLength ? `سياق ${fmtNum(m.contextLength)}` : ""}</div></td>
            <td className="px-3 py-3 text-xs">{m.planKeys.map((k) => plans.data?.plans.find((p) => p.key === k)?.name ?? k).join("، ") || <span className="text-slate-500">باقات «كل النماذج» فقط</span>}</td>
            <td className="px-3 py-3"><button onClick={() => run(`e${m.id}`, () => api(`/api/admin/models/${m.id}`, { method: "PATCH", body: { enabled: !m.enabled } }), m.enabled ? "تم تعطيل النموذج" : "تم تفعيل النموذج").then(() => reload())} aria-label="تبديل التفعيل"><OnOff on={m.enabled} /></button></td>
            <td className="px-3 py-3">
              <div className="flex justify-end gap-1">
                <button className="btn-outline px-2 py-1" disabled={busy === `t${m.id}`} onClick={() => test(m)} title="إرسال طلب اختبار حقيقي"><Play size={13} /> {busy === `t${m.id}` ? "…" : "اختبار"}</button>
                <button className="btn-outline px-2 py-1" onClick={() => setDraft({ ...m })}>تعديل</button>
                <button className="btn-ghost px-1.5 py-1 text-red-300" aria-label="حذف النموذج" onClick={() => confirm(`حذف ${m.displayName}؟`) && run("d", () => api(`/api/admin/models/${m.id}`, { method: "DELETE" }), "تم حذف النموذج").then(() => reload())}><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `تعديل ${draft.displayName}` : "إضافة نموذج"} wide>
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            {!draft.id && (
              <Field label="المزوّد">
                <select className="input" value={draft.providerId} onChange={(e) => setDraft({ ...draft, providerId: e.target.value })}>
                  {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="معرّف النموذج (يُرسل للمزوّد)"><input dir="ltr" className="input font-mono" value={draft.modelId ?? ""} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} /></Field>
            <Field label="الاسم الظاهر"><input className="input" value={draft.displayName ?? ""} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></Field>
            <Field label="الفئة">
              <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ModelRow["category"] })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
            </Field>
            <div className="sm:col-span-2"><Field label="الوصف"><textarea dir="auto" className="input min-h-[70px]" value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field></div>
            <Field label="ترتيب العرض" hint="الأصغر يظهر أولًا"><input className="input" type="number" value={draft.sortOrder ?? 1000} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></Field>
            <Field label="طول السياق"><input className="input" type="number" value={draft.contextLength ?? ""} onChange={(e) => setDraft({ ...draft, contextLength: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="سعر الإدخال $ لكل مليون توكن"><input className="input" type="number" step="0.0001" value={draft.inputPricePerM ?? ""} onChange={(e) => setDraft({ ...draft, inputPricePerM: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="سعر الإخراج $ لكل مليون توكن"><input className="input" type="number" step="0.0001" value={draft.outputPricePerM ?? ""} onChange={(e) => setDraft({ ...draft, outputPricePerM: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <p className="label">القدرات</p>
              <div className="grid gap-2 sm:grid-cols-3">{CAPS.map(([k, l]) => <Toggle key={k} checked={Boolean(draft[k])} onChange={(v) => setDraft({ ...draft, [k]: v })} label={l} />)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="label">متاح في الباقات</p>
              <div className="flex flex-wrap gap-3">
                {plans.data?.plans.map((p) => (
                  <Toggle key={p.key} checked={p.allowAllModels || (draft.planKeys ?? []).includes(p.key)} disabled={p.allowAllModels} hint={p.allowAllModels ? "تشمل كل النماذج" : undefined}
                    onChange={(v) => setDraft({ ...draft, planKeys: v ? [...(draft.planKeys ?? []), p.key] : (draft.planKeys ?? []).filter((x) => x !== p.key) })} label={p.name} />
                ))}
              </div>
            </div>
            <div className="sm:col-span-2"><Toggle checked={Boolean(draft.enabled)} onChange={(v) => setDraft({ ...draft, enabled: v })} label="مفعّل (يظهر للعملاء)" /></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setDraft(null)}>إلغاء</button>
              <button className="btn-primary" disabled={busy === "save" || !draft.modelId || !draft.displayName} onClick={saveDraft}>{busy === "save" ? "جارٍ الحفظ…" : "حفظ النموذج"}</button>
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
