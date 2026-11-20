import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { customerLogout } from "@/app/actions/customer";
import { SubmitButton } from "@/components/Forms";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { appTimezone } from "@/lib/config";
import { formatDateTime, formatMoney } from "@/lib/money";
import { currentCustomer } from "@/lib/session";

export const metadata: Metadata = { title: "رصيدي" };
export const dynamic = "force-dynamic";

export default async function BalancePage() {
  const customer = await currentCustomer();
  if (!customer) redirect("/");

  const negative = customer.balanceMinor < 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader>
        <form action={customerLogout}>
          <SubmitButton variant="ghost" pendingText="جارٍ الخروج…">تسجيل الخروج</SubmitButton>
        </form>
      </SiteHeader>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        <p className="text-sm text-white/50">مرحباً بك في Agentsii</p>
        <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{customer.name}</h1>

        <section className="card relative mt-6 overflow-hidden p-6 sm:p-8" aria-labelledby="bal-label">
          <div className="pointer-events-none absolute -top-28 -right-20 h-64 w-64 rounded-full bg-brand-violet/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-28 -left-20 h-64 w-64 rounded-full bg-brand-blue/20 blur-3xl" aria-hidden />

          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <p id="bal-label" className="text-sm font-medium text-white/60">الرصيد المتبقي</p>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
              رقم العميل: <span className="ltr-nums font-semibold text-white">{customer.number}</span>
            </span>
          </div>

          <p
            className={`relative mt-4 break-words text-4xl font-bold sm:text-5xl ltr-nums text-right ${
              negative ? "text-rose-300" : "text-white"
            }`}
          >
            {formatMoney(customer.balanceMinor, customer.currency)}
          </p>
          {negative && <p className="relative mt-2 text-sm text-rose-300/80">الرصيد بالسالب، يرجى التواصل مع فريق Agentsii.</p>}

          <dl className="relative mt-8 grid gap-4 border-t border-white/8 pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-white/45">اسم العميل</dt>
              <dd className="mt-1 font-semibold text-white">{customer.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-white/45">آخر تحديث للرصيد</dt>
              <dd className="mt-1 font-semibold text-white">
                {formatDateTime(customer.balanceUpdatedAt, appTimezone())}
              </dd>
            </div>
          </dl>
        </section>

        <p className="mt-6 text-center text-xs leading-6 text-white/40">
          لحمايتك، تنتهي الجلسة تلقائياً بعد 15 دقيقة. لأي استفسار عن رصيدك تواصل مع فريق Agentsii.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
