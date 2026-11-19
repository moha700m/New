"use client";
import { Play, RefreshCw, Wand2, Wifi } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, fmtDate, fmtNum, fmtUsd } from "@/components/api";
import { HealthBadge, PageHeader, Stat, useAction, useAdmin } from "@/components/admin/ui";
import type { ProviderRow } from "@/components/admin/types";

interface Overview { engine: { configVersion: number; activeProvider: string | null; effectiveDefaultModel: { id: string; name: string; provider: string } | null; fallbackEnabled: boolean; fallbackModel: { name: string; provider: string } | null; fallbackProvider: string | null } }
interface Usage { totals: { requests: number; tokens: number; costUsd: number | null }; byProvider: { provider: string; requests: number; tokens: number; costUsd: number | null; avgLatencyMs: number | null }[]; errors: { id: string; createdAt: string; modelKey: string; errorMessage: string | null; provider: { name: string } | null }[] }

export default function EnginesPage() {
  const ov = useAdmin<Overview>("/api/admin/overview");
  const pr = useAdmin<{ providers: ProviderRow[] }>("/api/admin/providers");
  const us = useAdmin<Usage>("/api/admin/usage?days=7");
  const { run, busy } = useAction();
  const [modelTest, setModelTest] = useState<{ ok: boolean; latencyMs: number; firstTokenMs: number | null; output: string; error: string | null } | null>(null);
  const reloadAll = () => { void ov.reload(); void pr.reload(); void us.reload(); };
  const e = ov.data?.engine;

  return (
    <>
      <PageHeader title="محركات الذكاء الاصطناعي" subtitle="الحالة المباشرة للمحركات التي تخدم العملاء." actions={<button className="btn-outline" onClick={reloadAll}><RefreshCw size={15} /> تحديث</button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="المزوّد النشط" value={e?.activeProvider ?? "—"} />
        <Stat label="النموذج النشط" value={<span className="text-lg"><bdi>{e?.effectiveDefaultModel?.name ?? "لا يوجد"}</bdi></span>} hint={e?.effectiveDefaultModel?.provider} tone={e?.effectiveDefaultModel ? undefined : "err"} />
        <Stat label="الطلبات (٧ أيام)" value={fmtNum(us.data?.totals.requests)} hint={`${fmtNum(us.data?.totals.tokens)} توكن`} />
        <Stat label="التكلفة التقديرية (٧ أيام)" value={fmtUsd(us.data?.totals.costUsd)} hint={`الأخطاء: ${us.data?.errors.length ?? 0}`} tone={us.data?.errors.length ? "warn" : undefined} />
      </div>

      <div className="card mt-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 text-sm">
          <b>اختبار النموذج الافتراضي</b> — يرسل طلبًا حقيقيًا إلى <span className="text-brand-400"><bdi>{e?.effectiveDefaultModel?.name ?? "—"}</bdi></span>.
          <span className="ms-2 text-slate-400">الاحتياطي: <bdi>{e?.fallbackEnabled ? (e.fallbackModel ? `${e.fallbackModel.name} (${e.fallbackModel.provider})` : e.fallbackProvider ?? "بدون هدف") : "معطّل"}</bdi></span>
        </div>
        <button className="btn-primary" disabled={!e?.effectiveDefaultModel || busy === "mt"} onClick={async () => { const r = await run("mt", () => api<{ result: typeof modelTest }>(`/api/admin/models/${e!.effectiveDefaultModel!.id}/test`, { method: "POST" })); if (r) setModelTest(r.result); }}>
          <Play size={15} /> {busy === "mt" ? "جارٍ الاختبار…" : "اختبار النموذج"}
        </button>
        {modelTest && (
          <div className={`w-full rounded-lg border px-3 py-2 text-sm ${modelTest.ok ? "border-emerald-500/30 bg-emerald-950/30" : "border-red-500/30 bg-red-950/30"}`}>
            {modelTest.ok ? <>✅ {modelTest.latencyMs} ملي ثانية (أول توكن بعد {modelTest.firstTokenMs ?? "—"} ملي ثانية): <bdi>{modelTest.output}</bdi></> : <>❌ <bdi>{modelTest.error}</bdi></>}
          </div>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">المحركات حسب المزوّد</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {pr.data?.providers.map((p) => {
          const u = us.data?.byProvider.find((x) => x.provider === p.name);
          return (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{p.name} {!p.enabled && <span className="text-xs font-normal text-slate-500">(معطّل)</span>}</h3>
                  <p className="text-xs text-slate-500">{p.type} · <bdi dir="ltr">{p.baseUrl}</bdi></p>
                </div>
                <HealthBadge status={p.healthStatus} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-slate-400">النماذج المتاحة</dt><dd>{p.modelCount}</dd>
                <dt className="text-slate-400">مفعّل / معطّل</dt><dd>{p.enabledModelCount} / {p.modelCount - p.enabledModelCount}</dd>
                <dt className="text-slate-400">مزامنة الكتالوج</dt><dd>{p.lastSyncAt ? `${p.lastSyncStatus === "ok" ? "ناجحة" : "فشلت"} · ${fmtDate(p.lastSyncAt, true)}` : "لم تتم"}</dd>
                <dt className="text-slate-400">الطلبات (٧ أيام)</dt><dd>{fmtNum(u?.requests ?? 0)} · {fmtNum(u?.tokens ?? 0)} توكن</dd>
                <dt className="text-slate-400">متوسط زمن الاستجابة</dt><dd>{u?.avgLatencyMs ? `${u.avgLatencyMs} ملي ثانية` : "—"}</dd>
                <dt className="text-slate-400">التكلفة التقديرية (٧ أيام)</dt><dd>{fmtUsd(u?.costUsd ?? null)}</dd>
              </dl>
              {p.lastHealthError && <p className="mt-2 text-xs text-amber-300">{p.lastHealthError}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `t${p.id}`} onClick={() => run(`t${p.id}`, () => api<{ result: { ok: boolean; detail: string } }>(`/api/admin/providers/${p.id}/test`, { method: "POST" }), (r) => (r.result.ok ? "✅ " : "⚠️ ") + r.result.detail).then(reloadAll)}><Wifi size={14} /> اختبار الاتصال</button>
                <button className="btn-outline px-2.5 py-1.5" disabled={busy === `s${p.id}`} onClick={() => run(`s${p.id}`, () => api<{ result: { discovered: number; created: number } }>(`/api/admin/providers/${p.id}/sync`, { method: "POST" }), (r) => `تم اكتشاف ${r.result.discovered} (${r.result.created} جديد)`).then(reloadAll)}><RefreshCw size={14} /> {busy === `s${p.id}` ? "جارٍ المزامنة…" : "مزامنة الكتالوج"}</button>
                {p.type === "VENICE" && <button className="btn-outline px-2.5 py-1.5" onClick={() => run(`sg${p.id}`, () => api<{ result: { applied: Record<string, string> } }>(`/api/admin/providers/${p.id}/suggested`, { method: "POST" }), (r) => `تم تطبيق افتراضيات Venice: ${Object.entries(r.result.applied).map(([k, v]) => `${k}=${v}`).join(", ")}`).then(reloadAll)}><Wand2 size={14} /> تطبيق الافتراضيات المقترحة من Venice</button>}
                <Link href={`/admin/models?providerId=${p.id}`} className="btn-ghost px-2.5 py-1.5">النماذج ←</Link>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">آخر أخطاء الطلبات</h2>
      <div className="card p-0">
        {!us.data?.errors.length ? <p className="p-4 text-sm text-slate-400">لا توجد أخطاء خلال آخر ٧ أيام.</p> : (
          <ul className="divide-y divide-ink-700 text-sm">
            {us.data.errors.slice(0, 15).map((er) => (
              <li key={er.id} className="px-4 py-2.5"><span className="text-slate-500">{fmtDate(er.createdAt, true)}</span> · <b>{er.provider?.name}</b> / {er.modelKey}<div className="text-xs text-red-300">{er.errorMessage}</div></li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
