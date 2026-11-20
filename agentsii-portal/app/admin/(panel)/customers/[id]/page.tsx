import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  changeBalance,
  deleteCustomer,
  resetPin,
  setCustomerStatus,
  unlockCustomer,
  updateCustomer,
} from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/Forms";
import { CurrencySelect, StatusBadge } from "@/components/admin/Bits";
import { appTimezone } from "@/lib/config";
import { readDb, type HistoryType } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/money";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "إدارة العميل" };
export const dynamic = "force-dynamic";

const HISTORY_LABEL: Record<HistoryType, string> = {
  create: "إنشاء الحساب",
  set: "تعيين الرصيد",
  credit: "إضافة",
  debit: "خصم",
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = await readDb();
  const c = db.customers.find((x) => x.id === id);
  if (!c) notFound();
  const tz = appTimezone();
  const locked = !!c.lockedUntil && new Date(c.lockedUntil).getTime() > Date.now();

  return (
    <div className="space-y-6">
      <nav className="text-sm text-white/45">
        <Link href="/admin" className="hover:text-white">العملاء</Link>
        <span className="mx-2" aria-hidden>‹</span>
        <span className="text-white/75">{c.name}</span>
      </nav>

      {/* Summary */}
      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-24 -left-16 h-56 w-56 rounded-full bg-brand-violet/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{c.name}</h1>
              <StatusBadge status={c.status} />
              {locked && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">
                  الدخول مقفل مؤقتاً
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-white/50">
              رقم العميل: <span className="ltr-nums font-semibold text-white/85">{c.number}</span>
            </p>
            {c.note && <p className="mt-2 text-sm text-white/45">ملاحظة: {c.note}</p>}
          </div>
          <div className="text-left">
            <p className="text-xs text-white/50">الرصيد الحالي</p>
            <p className={`mt-1 text-3xl font-bold ltr-nums ${c.balanceMinor < 0 ? "text-rose-300" : "text-white"}`}>
              {formatMoney(c.balanceMinor, c.currency)}
            </p>
            <p className="mt-1 text-xs text-white/40">آخر تحديث: {formatDateTime(c.balanceUpdatedAt, tz)}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Balance */}
        <section className="card p-5 sm:p-6" aria-labelledby="bal-title">
          <h2 id="bal-title" className="font-semibold text-white">تعديل الرصيد</h2>
          <p className="mt-1 mb-5 text-sm text-white/50">اختر العملية: تعيين قيمة جديدة، أو إضافة مبلغ، أو خصم مبلغ.</p>
          <ActionForm action={changeBalance} resetOnSuccess className="space-y-4">
            <input type="hidden" name="id" value={c.id} />
            <fieldset className="grid grid-cols-3 gap-2">
              <legend className="label">نوع العملية</legend>
              {[
                { v: "credit", l: "إضافة +" },
                { v: "debit", l: "خصم −" },
                { v: "set", l: "تعيين =" },
              ].map((o, i) => (
                <label
                  key={o.v}
                  className="flex cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white/70 transition has-[:checked]:border-brand-violet/70 has-[:checked]:bg-brand-violet/15 has-[:checked]:text-white"
                >
                  <input type="radio" name="mode" value={o.v} defaultChecked={i === 0} className="sr-only" />
                  {o.l}
                </label>
              ))}
            </fieldset>
            <div>
              <label className="label" htmlFor="amount">المبلغ ({c.currency})</label>
              <input id="amount" name="amount" inputMode="decimal" placeholder="0.00" className="input ltr-nums text-right" required />
              <p className="mt-1.5 text-xs text-white/40">في وضع «تعيين» يمكنك إدخال أي قيمة، بما فيها القيم السالبة.</p>
            </div>
            <div>
              <label className="label" htmlFor="bal-note">ملاحظة (اختياري)</label>
              <input id="bal-note" name="note" maxLength={200} className="input" placeholder="مثال: دفعة نقدية" />
            </div>
            <SubmitButton pendingText="جارٍ الحفظ…">تنفيذ العملية</SubmitButton>
          </ActionForm>
        </section>

        {/* Details */}
        <section className="card p-5 sm:p-6" aria-labelledby="edit-title">
          <h2 id="edit-title" className="font-semibold text-white">بيانات العميل</h2>
          <p className="mt-1 mb-5 text-sm text-white/50">تغيير رقم العميل يُنهي أي جلسة مفتوحة له.</p>
          <ActionForm action={updateCustomer} className="space-y-4">
            <input type="hidden" name="id" value={c.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="name">الاسم</label>
                <input id="name" name="name" defaultValue={c.name} maxLength={80} className="input" required />
              </div>
              <div>
                <label className="label" htmlFor="number">رقم العميل</label>
                <input id="number" name="number" defaultValue={c.number} inputMode="numeric" maxLength={20} className="input ltr-nums text-right" required />
              </div>
              <div>
                <label className="label" htmlFor="currency">العملة</label>
                <CurrencySelect id="currency" defaultValue={c.currency} />
              </div>
              <div>
                <label className="label" htmlFor="note">ملاحظة داخلية</label>
                <input id="note" name="note" defaultValue={c.note ?? ""} maxLength={200} className="input" />
              </div>
            </div>
            <SubmitButton variant="ghost" pendingText="جارٍ الحفظ…">حفظ البيانات</SubmitButton>
          </ActionForm>
        </section>

        {/* Security */}
        <section className="card p-5 sm:p-6" aria-labelledby="sec-title">
          <h2 id="sec-title" className="font-semibold text-white">الأمان والحالة</h2>
          <div className="mt-5 space-y-6">
            <ActionForm action={resetPin} resetOnSuccess className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <label className="label" htmlFor="pin">رمز PIN جديد (4–8 أرقام)</label>
              <div className="flex gap-2">
                <input id="pin" name="pin" inputMode="numeric" maxLength={8} autoComplete="off" className="input ltr-nums text-right" required />
                <SubmitButton variant="ghost" className="shrink-0" pendingText="…">تغيير PIN</SubmitButton>
              </div>
            </ActionForm>

            {locked && (
              <ActionForm action={unlockCustomer}>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton variant="ghost">إلغاء قفل تسجيل الدخول</SubmitButton>
              </ActionForm>
            )}

            <ActionForm
              action={setCustomerStatus}
              confirmText={c.status === "active" ? `إيقاف حساب ${c.name}؟ لن يتمكن من عرض رصيده.` : undefined}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4"
            >
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="status" value={c.status === "active" ? "suspended" : "active"} />
              <div>
                <p className="text-sm font-medium text-white">{c.status === "active" ? "إيقاف الحساب" : "تفعيل الحساب"}</p>
                <p className="text-xs text-white/45">
                  {c.status === "active" ? "يمنع العميل من الدخول مع الاحتفاظ ببياناته." : "يسمح للعميل بعرض رصيده من جديد."}
                </p>
              </div>
              <SubmitButton variant={c.status === "active" ? "danger" : "primary"}>
                {c.status === "active" ? "إيقاف" : "تفعيل"}
              </SubmitButton>
            </ActionForm>
          </div>
        </section>

        {/* Danger zone */}
        <section className="card border-rose-500/20 p-5 sm:p-6" aria-labelledby="del-title">
          <h2 id="del-title" className="font-semibold text-rose-200">حذف العميل نهائياً</h2>
          <p className="mt-1 mb-5 text-sm text-white/50">
            لا يمكن التراجع عن الحذف. للتأكيد اكتب رقم العميل <span className="ltr-nums font-semibold text-white/80">{c.number}</span>.
          </p>
          <ActionForm action={deleteCustomer} confirmText={`حذف ${c.name} نهائياً؟`} className="flex gap-2">
            <input type="hidden" name="id" value={c.id} />
            <input name="confirm" inputMode="numeric" aria-label="رقم العميل للتأكيد" className="input ltr-nums text-right" autoComplete="off" required />
            <SubmitButton variant="danger" className="shrink-0" pendingText="…">حذف</SubmitButton>
          </ActionForm>
        </section>
      </div>

      {/* History */}
      <section className="card overflow-hidden" aria-labelledby="hist-title">
        <h2 id="hist-title" className="border-b border-white/8 p-5 font-semibold text-white">سجل حركات الرصيد</h2>
        {c.history.length === 0 ? (
          <p className="p-6 text-sm text-white/45">لا توجد حركات بعد.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {c.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-white/85">
                    {HISTORY_LABEL[h.type]}
                    {h.note && h.type !== "create" && <span className="text-white/45"> — {h.note}</span>}
                  </p>
                  <p className="text-xs text-white/40">{formatDateTime(h.at, tz)}</p>
                </div>
                <div className="text-left">
                  <p
                    className={`font-semibold ltr-nums ${
                      h.type === "credit" ? "text-emerald-300" : h.type === "debit" ? "text-rose-300" : "text-white/85"
                    }`}
                  >
                    {formatMoney(h.amountMinor, c.currency, { signed: h.type === "credit" || h.type === "debit" })}
                  </p>
                  <p className="text-xs text-white/40">
                    الرصيد بعدها: <span className="ltr-nums">{formatMoney(h.balanceAfterMinor, c.currency)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
