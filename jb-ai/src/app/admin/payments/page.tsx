"use client";
import { useState } from "react";
import { api, fmtDate, money } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";

interface Data {
  status: { secretKeyConfigured: boolean; secretKeySource: string | null; secretKeyLast4: string | null; mode: string | null; webhookSecretConfigured: boolean; webhookSecretLast4: string | null; webhookUrl: string };
  payments: { id: string; createdAt: string; amountCents: number; currency: string; status: string; description: string | null; providerPaymentId: string; user: { email: string } }[];
  subscriptions: { id: string; status: string; interval: string; provider: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; user: { email: string }; plan: { name: string } }[];
  events: { id: string; type: string; processedAt: string; outcome: string | null }[];
}

export default function PaymentsAdmin() {
  const { data, reload } = useAdmin<Data>("/api/admin/payments");
  const { run, busy } = useAction();
  const [sk, setSk] = useState("");
  const [wh, setWh] = useState("");
  const s = data?.status;
  return (
    <>
      <PageHeader title="المدفوعات" subtitle="صفحة دفع Stripe المستضافة وبوابة الفوترة. الاشتراك لا يتفعّل إلا من إشعار Stripe موقَّع وتم التحقق منه." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">الاتصال</h2>
          <p>المفتاح السري: <OnOff on={Boolean(s?.secretKeyConfigured)} onLabel={`مضاف ••••${s?.secretKeyLast4 ?? ""} (${s?.secretKeySource === "dashboard" ? "من لوحة التحكم" : "من متغيرات البيئة"})`} offLabel="غير مضاف" /> {s?.mode && <span className="badge ms-1 bg-brand-500/15 text-brand-400">{s.mode === "test" ? "وضع التجربة" : "الوضع الحقيقي"}</span>}</p>
          <p>سر الإشعارات (Webhook): <OnOff on={Boolean(s?.webhookSecretConfigured)} onLabel={`مضاف ••••${s?.webhookSecretLast4 ?? ""}`} offLabel="غير مضاف" /></p>
          <div className="rounded-lg bg-ink-800 p-3 text-xs text-slate-400">
            من لوحة Stripe ← Developers ← Webhooks، أضف العنوان <code className="text-slate-200">{s?.webhookUrl}</code> مع الأحداث: <code>checkout.session.completed</code> و <code>customer.subscription.created/updated/deleted</code> و <code>invoice.paid</code> و <code>invoice.payment_failed</code>، ثم الصق سر التوقيع (signing secret) بالأسفل.
          </div>
          <button className="btn-outline" disabled={busy === "test"} onClick={() => run("test", () => api<{ result: { ok: boolean; livemode?: boolean; error?: string; available?: string[] } }>("/api/admin/payments", { method: "POST" }), (r) => (r.result.ok ? `Stripe متصل (${r.result.livemode ? "الوضع الحقيقي" : "وضع التجربة"}). الرصيد: ${r.result.available?.join("، ")}` : `فشل اختبار Stripe: ${r.result.error}`))}>اختبار الاتصال بـ Stripe</button>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">المفاتيح (للمالك فقط)</h2>
          <Field label="المفتاح السري لـ Stripe" hint="sk_test_… للتجربة، و sk_live_… للتشغيل الحقيقي. يُخزَّن مشفّرًا."><input dir="ltr" className="input font-mono" type="password" autoComplete="off" value={sk} onChange={(e) => setSk(e.target.value)} /></Field>
          <Field label="سر توقيع الإشعارات (Webhook)"><input dir="ltr" className="input font-mono" type="password" autoComplete="off" value={wh} onChange={(e) => setWh(e.target.value)} placeholder="whsec_…" /></Field>
          <button className="btn-primary" disabled={!sk && !wh} onClick={() => run("save", () => api("/api/admin/payments", { method: "PUT", body: { ...(sk ? { secretKey: sk } : {}), ...(wh ? { webhookSecret: wh } : {}) } }), "تم حفظ مفاتيح الدفع").then(() => { setSk(""); setWh(""); reload(); })}>حفظ المفاتيح</button>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">الاشتراكات</h2>
      <Table head={["المستخدم", "الباقة", "الحالة", "الدورة", "نهاية الفترة", "المصدر"]} empty={!data?.subscriptions.length}>
        {data?.subscriptions.map((x) => <tr key={x.id}><td className="px-3 py-2"><bdi dir="ltr">{x.user.email}</bdi></td><td className="px-3 py-2">{x.plan.name}</td><td className="px-3 py-2">{({ ACTIVE: "نشط", TRIALING: "تجريبي", PAST_DUE: "متأخر السداد", CANCELED: "ملغى", EXPIRED: "منتهي", INCOMPLETE: "غير مكتمل" } as Record<string, string>)[x.status] ?? x.status}{x.cancelAtPeriodEnd && " (سيُلغى)"}</td><td className="px-3 py-2">{x.interval === "YEAR" ? "سنوي" : "شهري"}</td><td className="px-3 py-2">{fmtDate(x.currentPeriodEnd)}</td><td className="px-3 py-2">{x.provider === "manual" ? "يدوي" : x.provider}</td></tr>)}
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">المدفوعات</h2>
      <Table head={["التاريخ", "المستخدم", "المبلغ", "الحالة", "المرجع"]} empty={!data?.payments.length}>
        {data?.payments.map((p) => <tr key={p.id}><td className="px-3 py-2">{fmtDate(p.createdAt, true)}</td><td className="px-3 py-2"><bdi dir="ltr">{p.user.email}</bdi></td><td className="px-3 py-2"><bdi>{money(p.amountCents, p.currency)}</bdi></td><td className="px-3 py-2">{({ paid: "مدفوعة", failed: "فشلت" } as Record<string, string>)[p.status] ?? p.status}</td><td className="px-3 py-2 font-mono text-xs">{p.providerPaymentId}</td></tr>)}
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">إشعارات الدفع الموثّقة</h2>
      <Table head={["وقت الاستلام", "النوع", "النتيجة", "معرّف الحدث"]} empty={!data?.events.length}>
        {data?.events.map((e) => <tr key={e.id}><td className="px-3 py-2 text-xs">{fmtDate(e.processedAt, true)}</td><td className="px-3 py-2 text-xs">{e.type}</td><td className="px-3 py-2 text-xs">{e.outcome}</td><td className="px-3 py-2 font-mono text-xs">{e.id}</td></tr>)}
      </Table>
    </>
  );
}
