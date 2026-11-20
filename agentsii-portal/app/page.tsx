import Link from "next/link";
import { CustomerLoginForm } from "@/components/CustomerLoginForm";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

const features = [
  { title: "دخول آمن", body: "رقم العميل مع رمز PIN خاص بك، وجلسة تنتهي تلقائياً." },
  { title: "رصيد محدّث", body: "يظهر رصيدك المتبقي كما سجّله فريق Agentsii مع وقت آخر تحديث." },
  { title: "خصوصية كاملة", body: "لا تُعرض بياناتك لأي شخص آخر، وتتم كل العمليات على الخادم." },
];

export default function HomePage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="grid-bg pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <SiteHeader>
        <Link href="/admin" className="btn-ghost text-xs sm:text-sm">لوحة الإدارة</Link>
      </SiteHeader>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-16">
        <section>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-violet/30 bg-brand-violet/10 px-3 py-1 text-xs font-medium text-violet-200">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan" aria-hidden />
            بوابة أرصدة عملاء Agentsii
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.25] text-white sm:text-5xl">
            رصيدك لدى <span className="gradient-text" dir="ltr">Agentsii</span>
            <br />
            واضح ومتاح في أي وقت.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-8 text-white/60 sm:text-lg">
            أدخل رقم العميل ورمز PIN لعرض اسمك ورصيدك المتبقي وآخر تحديث تم على حسابك.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {features.map((f) => (
              <li key={f.title} className="card p-4">
                <p className="text-sm font-semibold text-white">{f.title}</p>
                <p className="mt-1.5 text-xs leading-6 text-white/50">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="login-title" className="card relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -top-24 -left-24 h-56 w-56 rounded-full bg-brand-blue/20 blur-3xl" aria-hidden />
          <h2 id="login-title" className="text-xl font-bold text-white">الاستعلام عن الرصيد</h2>
          <p className="mt-1.5 mb-6 text-sm text-white/50">ستجد رقم العميل ورمز PIN لدى فريق Agentsii.</p>
          <CustomerLoginForm />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
