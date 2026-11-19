"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Field, OnOff, PageHeader, useAction, useAdmin } from "@/components/admin/ui";
import { Toggle } from "@/components/ui/Toggle";

interface S { siteName: string; tagline: string; registrationOpen: boolean; requireEmailVerification: boolean; systemPrompt: string; maxHistoryMessages: number; chatRateLimitPerMinute: number; maintenanceMode: boolean; supportEmail: string }
interface Env { mailerConfigured: boolean; appUrl: string | null; ownerEmailConfigured: boolean; encryptionKeyConfigured: boolean; nodeEnv: string }

export default function SystemPage() {
  const { data, reload } = useAdmin<{ settings: S; environment: Env }>("/api/admin/settings");
  const { run, busy } = useAction();
  const [s, setS] = useState<S | null>(null);
  useEffect(() => setS(data?.settings ?? null), [data]);
  if (!s || !data) return <p className="text-slate-400">جارٍ التحميل…</p>;
  const env = data.environment;
  return (
    <>
      <PageHeader title="إعدادات النظام" actions={<button className="btn-primary" disabled={busy === "s"} onClick={() => run("s", () => api("/api/admin/settings", { method: "PUT", body: s }), "تم حفظ الإعدادات").then(() => reload())}>حفظ الإعدادات</button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الموقع"><input className="input" value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} /></Field>
            <Field label="بريد الدعم"><input dir="ltr" className="input" value={s.supportEmail} onChange={(e) => setS({ ...s, supportEmail: e.target.value })} /></Field>
          </div>
          <Field label="العبارة التعريفية (الشاشة الرئيسية)"><input className="input" value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} /></Field>
          <Field label="تعليمات النظام (System prompt)" hint="تُرسل كرسالة نظام مع كل طلب محادثة."><textarea dir="auto" className="input min-h-[120px]" value={s.systemPrompt} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="أقصى عدد رسائل سابقة في كل طلب"><input className="input" type="number" value={s.maxHistoryMessages} onChange={(e) => setS({ ...s, maxHistoryMessages: Number(e.target.value) })} /></Field>
            <Field label="حد الطلبات (طلب لكل مستخدم في الدقيقة)"><input className="input" type="number" value={s.chatRateLimitPerMinute} onChange={(e) => setS({ ...s, chatRateLimitPerMinute: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle checked={s.registrationOpen} onChange={(v) => setS({ ...s, registrationOpen: v })} label="التسجيل مفتوح" />
            <Toggle checked={s.requireEmailVerification} onChange={(v) => setS({ ...s, requireEmailVerification: v })} label="اشتراط تأكيد البريد" hint={env.mailerConfigured ? undefined : "غير فعّال حتى يتم إعداد SMTP"} />
            <Toggle checked={s.maintenanceMode} onChange={(v) => setS({ ...s, maintenanceMode: v })} label="وضع الصيانة" />
          </div>
        </div>
        <div className="card space-y-2 text-sm">
          <h2 className="font-semibold">بيئة التشغيل</h2>
          <p>البيئة: <b><bdi dir="ltr">{env.nodeEnv}</bdi></b></p>
          <p>عنوان الموقع: <bdi dir="ltr" className="break-all text-slate-300">{env.appUrl ?? "غير محدد"}</bdi></p>
          <p>البريد (SMTP): <OnOff on={env.mailerConfigured} onLabel="مُعدّ" offLabel="غير مُعدّ" /></p>
          <p>مفتاح التشفير: <OnOff on={env.encryptionKeyConfigured} onLabel="مُعدّ" offLabel="مفقود" /></p>
          <p>بريد المالك: <OnOff on={env.ownerEmailConfigured} onLabel="مُعدّ" offLabel="غير محدد" /></p>
          <p className="pt-2 text-xs text-slate-500">الأسرار (رابط قاعدة البيانات، ومفتاح التشفير الرئيسي، وSMTP) محفوظة في متغيرات البيئة لدى منصة الاستضافة ولا تُعرض هنا أبدًا.</p>
        </div>
      </div>
    </>
  );
}
