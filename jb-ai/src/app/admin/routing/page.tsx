"use client";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import type { ModelRow, ProviderRow } from "@/components/admin/types";
import { Field, PageHeader, useAction, useAdmin } from "@/components/admin/ui";
import { Toggle } from "@/components/ui/Toggle";

type Routing = Record<string, string | boolean | null>;
const ROLES: [string, string, (m: ModelRow) => boolean][] = [
  ["defaultTextModelId", "النموذج الافتراضي للنصوص", (m) => m.supportsText],
  ["defaultReasoningModelId", "النموذج الافتراضي للتفكير (زر تفكير)", (m) => m.supportsText],
  ["defaultCodingModelId", "النموذج الافتراضي للبرمجة", (m) => m.supportsText],
  ["defaultVisionModelId", "النموذج الافتراضي للرؤية (قراءة الصور)", (m) => m.supportsText && m.supportsVision],
  ["defaultImageModelId", "النموذج الافتراضي لتوليد الصور", (m) => m.supportsImageGeneration],
];

export default function RoutingPage() {
  const { data, reload } = useAdmin<{ routing: Routing }>("/api/admin/routing");
  const [showAll, setShowAll] = useState(false);
  const models = useAdmin<{ models: ModelRow[] }>(`/api/admin/models?status=${showAll ? "all" : "enabled"}`);
  const providers = useAdmin<{ providers: ProviderRow[] }>("/api/admin/providers");
  const { run, busy } = useAction();
  const [r, setR] = useState<Routing | null>(null);
  useEffect(() => setR(data?.routing ?? null), [data]);
  if (!r) return <p className="text-slate-400">جارٍ التحميل…</p>;

  const list = models.data?.models ?? [];
  const select = (key: string, filter: (m: ModelRow) => boolean, providerScope?: string | null) => (
    <select className="input" value={(r[key] as string) ?? ""} onChange={(e) => setR({ ...r, [key]: e.target.value || null })}>
      <option value="">— تلقائي —</option>
      {(providers.data?.providers ?? []).filter((p) => !providerScope || p.id === providerScope).map((p) => {
        const opts = list.filter((m) => m.providerId === p.id && filter(m));
        if (!opts.length) return null;
        return (
          <optgroup key={p.id} label={p.name}>
            {opts.map((m) => <option key={m.id} value={m.id}>{m.displayName}{!m.enabled ? " (معطّل — سيتم تفعيله)" : ""}</option>)}
          </optgroup>
        );
      })}
    </select>
  );

  async function save() {
    const body: Routing = {};
    for (const k of ["defaultProviderId", "defaultTextModelId", "defaultReasoningModelId", "defaultCodingModelId", "defaultVisionModelId", "defaultImageModelId", "fallbackEnabled", "fallbackProviderId", "fallbackModelId"]) body[k] = r![k] ?? null;
    body.fallbackEnabled = Boolean(r!.fallbackEnabled);
    const ok = await run("save", () => api("/api/admin/routing", { method: "PUT", body }), "تم حفظ التوجيه — تُطبَّق على الطلبات الجديدة فورًا");
    if (ok) { void reload(); void models.reload(); }
  }

  return (
    <>
      <PageHeader title="قواعد التوجيه" subtitle="توجيه كل طلب ذكاء اصطناعي يتم من الخادم. العميل يختار من نماذج الكتالوج فقط، أما المزوّدون والعناوين والمفاتيح فتأتي دائمًا من هنا." actions={<button className="btn-primary" disabled={busy === "save"} onClick={save}><Save size={15} /> حفظ التوجيه</button>} />
      <div className="mb-4"><Toggle checked={showAll} onChange={setShowAll} label="إظهار النماذج المعطّلة في القوائم" /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-semibold">الافتراضيات</h2>
          <Field label="مزوّد الذكاء الاصطناعي الافتراضي" hint="يُستخدم عندما لا يكون هناك نموذج افتراضي محدد للدور.">
            <select className="input" value={(r.defaultProviderId as string) ?? ""} onChange={(e) => setR({ ...r, defaultProviderId: e.target.value || null })}>
              <option value="">— بدون —</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.enabled ? " (معطّل)" : ""}</option>)}
            </select>
          </Field>
          {ROLES.map(([k, label, f]) => <Field key={k} label={label}>{select(k, f)}</Field>)}
        </div>
        <div className="card space-y-4">
          <h2 className="font-semibold">الاحتياطي</h2>
          <Toggle checked={Boolean(r.fallbackEnabled)} onChange={(v) => setR({ ...r, fallbackEnabled: v })} label="تفعيل التحويل التلقائي للاحتياطي" hint="إذا فشل المزوّد الأساسي قبل أن يرد (مصادقة، رصيد، انتهاء مهلة، خطأ 5xx) يُعاد الطلب على الاحتياطي." />
          <Field label="المزوّد الاحتياطي" hint="يجرّب نفس معرّف النموذج عند هذا المزوّد أولًا، ثم أول نموذج مفعّل لديه.">
            <select className="input" value={(r.fallbackProviderId as string) ?? ""} onChange={(e) => setR({ ...r, fallbackProviderId: e.target.value || null })}>
              <option value="">— بدون —</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="النموذج الاحتياطي">{select("fallbackModelId", (m) => m.supportsText || m.supportsImageGeneration)}</Field>
          <div className="rounded-lg bg-ink-800 p-3 text-xs leading-5 text-slate-400">
            مسار الطلب: مستخدم مسجّل ← فحص الباقة والحصة ← النموذج المطلوب من الكتالوج (أو افتراضي الدور) ← محوّل المزوّد ← عند الفشل قبل أول توكن: إعادة محاولة واحدة للأخطاء المؤقتة ثم الاحتياطي. لا يتم خلط ردّين من نموذجين مختلفين أبدًا.
          </div>
        </div>
      </div>
    </>
  );
}
