import Link from "next/link";
import { adminLogout } from "@/app/actions/admin";
import { SubmitButton } from "@/components/Forms";
import { Logo } from "@/components/Logo";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-white/8 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" aria-label="لوحة الإدارة"><Logo /></Link>
            <span className="hidden rounded-md border border-brand-violet/30 bg-brand-violet/10 px-2 py-0.5 text-[11px] font-semibold text-violet-200 sm:inline">
              لوحة الإدارة
            </span>
          </div>
          <form action={adminLogout}>
            <SubmitButton variant="ghost" pendingText="…">تسجيل الخروج</SubmitButton>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="py-6 text-center text-xs text-white/30">Agentsii · لوحة الإدارة</footer>
    </div>
  );
}
