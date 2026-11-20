import type { Metadata } from "next";
import Link from "next/link";
import { createCustomer } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/Forms";
import { CurrencySelect, StatusBadge } from "@/components/admin/Bits";
import { appTimezone, defaultCurrency } from "@/lib/config";
import { readDb } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/money";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "لوحة الإدارة" };
export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; status?: string; deleted?: string }>;

export default async function AdminDashboard({ searchParams }: { searchParams: Search }) {
  await requireAdmin();
  const { q = "", status = "all", deleted } = await searchParams;
  const db = await readDb();
  const tz = appTimezone();

  const all = [...db.customers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = all.filter((c) => c.status === "active").length;
  const totals = new Map<string, number>();
  for (const c of all) totals.set(c.currency, (totals.get(c.currency) ?? 0) + c.balanceMinor);

  const query = q.trim().toLowerCase();
  const list = all.filter((c) => {
    if (status === "active" && c.status !== "active") return false;
    if (status === "suspended" && c.status !== "suspended") return false;
    if (!query) return true;
    return c.name.toLowerCase().includes(query) || c.number.includes(query);
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">أرصدة عملاء Agentsii</h1>
          <p className="mt-1 text-sm text-white/50">أضف العملاء، وحدّث أرصدتهم، وتابع جميع الحسابات من مكان واحد.</p>
        </div>
        <a href="#new-customer" className="btn-primary">+ إضافة عميل</a>
      </div>

      {deleted && (
        <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          تم حذف العميل نهائياً.
        </p>
      )}

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="إحصائيات">
        <Stat label="إجمالي العملاء" value={String(all.length)} />
        <Stat label="حسابات نشطة" value={String(active)} tone="emerald" />
        <Stat label="حسابات موقوفة" value={String(all.length - active)} tone="rose" />
        <div className="card p-5">
          <p className="text-xs text-white/50">مجموع الأرصدة</p>
          {totals.size === 0 ? (
            <p className="mt-2 text-2xl font-bold text-white ltr-nums text-right">0.00</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {[...totals].map(([cur, sum]) => (
                <li key={cur} className="text-lg font-bold text-white ltr-nums text-right">{formatMoney(sum, cur)}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Customers list */}
      <section className="card overflow-hidden" aria-labelledby="list-title">
        <div className="flex flex-col gap-3 border-b border-white/8 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <h2 id="list-title" className="font-semibold text-white">
            العملاء <span className="text-white/40">({list.length})</span>
          </h2>
          <form className="flex flex-col gap-2 sm:flex-row" role="search">
            <input name="q" defaultValue={q} placeholder="ابحث بالاسم أو رقم العميل" className="input py-2 sm:w-64" aria-label="بحث" />
            <div className="flex gap-2">
              <select name="status" defaultValue={status} className="input py-2 sm:w-36" aria-label="الحالة">
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="suspended">موقوف</option>
              </select>
              <button className="btn-ghost shrink-0">بحث</button>
            </div>
          </form>
        </div>

        {list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium text-white/80">{all.length === 0 ? "لا يوجد عملاء بعد" : "لا توجد نتائج مطابقة"}</p>
            <p className="mt-1 text-sm text-white/45">
              {all.length === 0 ? "ابدأ بإضافة أول عميل من النموذج أدناه." : "جرّب كلمة بحث أخرى أو غيّر فلتر الحالة."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.02] text-right text-xs text-white/45">
                  <tr>
                    <th className="px-5 py-3 font-medium">رقم العميل</th>
                    <th className="px-5 py-3 font-medium">الاسم</th>
                    <th className="px-5 py-3 font-medium">الرصيد</th>
                    <th className="px-5 py-3 font-medium">الحالة</th>
                    <th className="px-5 py-3 font-medium">آخر تحديث للرصيد</th>
                    <th className="px-5 py-3"><span className="sr-only">إجراءات</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {list.map((c) => (
                    <tr key={c.id} className="transition hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5 font-semibold text-white"><span className="ltr-nums">{c.number}</span></td>
                      <td className="px-5 py-3.5 text-white/85">{c.name}</td>
                      <td className={`px-5 py-3.5 font-semibold ${c.balanceMinor < 0 ? "text-rose-300" : "text-white"}`}>
                        <span className="ltr-nums">{formatMoney(c.balanceMinor, c.currency)}</span>
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                      <td className="px-5 py-3.5 text-white/55">{formatDateTime(c.balanceUpdatedAt, tz)}</td>
                      <td className="px-5 py-3.5 text-left">
                        <Link href={`/admin/customers/${c.id}`} className="btn-ghost px-3 py-1.5 text-xs">إدارة</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-white/5 md:hidden">
              {list.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/customers/${c.id}`} className="block p-4 transition hover:bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{c.name}</p>
                        <p className="mt-0.5 text-xs text-white/45">رقم العميل: <span className="ltr-nums">{c.number}</span></p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className={`text-lg font-bold ltr-nums ${c.balanceMinor < 0 ? "text-rose-300" : "text-white"}`}>
                        {formatMoney(c.balanceMinor, c.currency)}
                      </p>
                      <p className="text-[11px] text-white/40">{formatDateTime(c.balanceUpdatedAt, tz)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* New customer */}
      <section id="new-customer" className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby="new-title">
        <h2 id="new-title" className="font-semibold text-white">إضافة عميل جديد</h2>
        <p className="mt-1 mb-5 text-sm text-white/50">حدّد رقم العميل ورمز PIN ثم سلّمهما للعميل ليتمكن من عرض رصيده.</p>
        <ActionForm action={createCustomer} resetOnSuccess className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor="nc-name">اسم العميل</label>
            <input id="nc-name" name="name" className="input" maxLength={80} required />
          </div>
          <div>
            <label className="label" htmlFor="nc-number">رقم العميل</label>
            <input id="nc-number" name="number" inputMode="numeric" maxLength={20} className="input ltr-nums text-right" required />
          </div>
          <div>
            <label className="label" htmlFor="nc-pin">رمز PIN (4–8 أرقام)</label>
            <input id="nc-pin" name="pin" inputMode="numeric" maxLength={8} autoComplete="off" className="input ltr-nums text-right" required />
          </div>
          <div>
            <label className="label" htmlFor="nc-balance">الرصيد الافتتاحي</label>
            <input id="nc-balance" name="balance" inputMode="decimal" placeholder="0.00" className="input ltr-nums text-right" />
          </div>
          <div>
            <label className="label" htmlFor="nc-currency">العملة</label>
            <CurrencySelect id="nc-currency" defaultValue={defaultCurrency()} />
          </div>
          <div>
            <label className="label" htmlFor="nc-note">ملاحظة داخلية (اختياري)</label>
            <input id="nc-note" name="note" maxLength={200} className="input" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <SubmitButton pendingText="جارٍ الإضافة…">إضافة العميل</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "rose" ? "text-rose-300" : "text-white";
  return (
    <div className="card p-5">
      <p className="text-xs text-white/50">{label}</p>
      <p className={`mt-2 text-3xl font-bold ltr-nums text-right ${color}`}>{value}</p>
    </div>
  );
}
