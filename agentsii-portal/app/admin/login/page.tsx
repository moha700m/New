import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { Logo } from "@/components/Logo";
import { isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "دخول الإدارة" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size="lg" />
          <p className="text-sm text-white/50">لوحة إدارة أرصدة عملاء Agentsii</p>
        </div>
        <div className="card p-6">
          <AdminLoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-white/40">
          <Link href="/" className="hover:text-white/70">العودة إلى صفحة العملاء</Link>
        </p>
      </div>
    </main>
  );
}
