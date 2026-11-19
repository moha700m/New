"use client";
import Link from "next/link";
import { fmtNum, fmtUsd, money } from "@/components/api";
import { HealthBadge, PageHeader, Stat, useAdmin } from "@/components/admin/ui";

interface Overview {
  stats: Record<string, number | null>;
  engine: { configVersion: number; activeProvider: string | null; defaultModel: { name: string; provider: string } | null; effectiveDefaultModel: { name: string; provider: string } | null; fallbackEnabled: boolean; fallbackProvider: string | null; fallbackModel: { name: string; provider: string } | null };
  providers: { id: string; name: string; type: string; enabled: boolean; healthStatus: string; lastHealthError: string | null; hasApiKey: boolean; lastSyncAt: string | null }[];
}

export default function AdminOverview() {
  const { data } = useAdmin<Overview>("/api/admin/overview");
  if (!data) return <p className="text-slate-400">جارٍ التحميل…</p>;
  const s = data.stats;
  const e = data.engine;
  return (
    <>
      <PageHeader title="نظرة عامة" subtitle={`إصدار الإعدادات المباشرة: ${e.configVersion}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="المستخدمون" value={fmtNum(s.users)} hint={`${fmtNum(s.newUsers)} جديد هذا الشهر`} />
        <Stat label="الاشتراكات النشطة" value={fmtNum(s.activeSubscriptions)} hint={`إيرادات هذا الشهر ${money(s.revenueMonthCents ?? 0)}`} />
        <Stat label="طلبات الذكاء الاصطناعي اليوم" value={fmtNum(s.requestsToday)} hint={`إجمالي المحادثات ${fmtNum(s.conversations)}`} />
        <Stat label="الأخطاء (٢٤ ساعة)" value={fmtNum(s.errors24h)} tone={(s.errors24h ?? 0) > 0 ? "warn" : "ok"} />
        <Stat label="التوكنز هذا الشهر" value={fmtNum(s.tokensMonth)} />
        <Stat label="تكلفة الـ API هذا الشهر" value={fmtUsd(s.costMonthUsd, 4)} hint="من المزوّد مباشرة أو تقديرية حسب تسعير النموذج" />
        <Stat label="النماذج المفعّلة" value={`${fmtNum(s.modelsEnabled)} / ${fmtNum(s.modelsTotal)}`} />
        <Stat label="الظاهرة للعملاء" value={fmtNum(s.customerVisibleModels)} tone={s.customerVisibleModels ? "ok" : "err"} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between"><h2 className="font-semibold">المحرك النشط</h2><Link href="/admin/routing" className="text-sm text-brand-400">التوجيه ←</Link></div>
          <dl className="mt-3 grid grid-cols-[150px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-400">المزوّد الافتراضي</dt><dd>{e.activeProvider ?? <span className="text-amber-300">غير محدد</span>}</dd>
            <dt className="text-slate-400">النموذج الافتراضي</dt><dd><bdi>{e.effectiveDefaultModel ? `${e.effectiveDefaultModel.name} (${e.effectiveDefaultModel.provider})` : <span className="text-red-300">لا يوجد نموذج صالح</span>}</bdi></dd>
            <dt className="text-slate-400">الاحتياطي</dt><dd><bdi>{e.fallbackEnabled ? (e.fallbackModel ? `${e.fallbackModel.name} (${e.fallbackModel.provider})` : e.fallbackProvider ?? "مفعّل بدون هدف") : "معطّل"}</bdi></dd>
          </dl>
        </div>
        <div className="card">
          <div className="flex items-center justify-between"><h2 className="font-semibold">المزوّدون</h2><Link href="/admin/providers" className="text-sm text-brand-400">إدارة ←</Link></div>
          <ul className="mt-3 space-y-2 text-sm">
            {data.providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.name} <span className="text-xs text-slate-500">{p.type}</span>{!p.enabled && <span className="ms-2 text-xs text-slate-500">(معطّل)</span>}{!p.hasApiKey && <span className="ms-2 text-xs text-amber-300">بدون مفتاح API</span>}</span>
                <HealthBadge status={p.healthStatus} />
              </li>
            ))}
          </ul>
          {data.providers.some((p) => p.lastHealthError) && <p className="mt-3 text-xs text-amber-300/90">{data.providers.find((p) => p.lastHealthError)?.lastHealthError}</p>}
        </div>
      </div>
    </>
  );
}
