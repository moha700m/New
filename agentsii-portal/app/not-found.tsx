import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <Logo size="lg" />
      <h1 className="text-xl font-bold text-white">الصفحة غير موجودة</h1>
      <p className="text-sm text-white/50">الرابط الذي طلبته غير متاح على Agentsii.</p>
      <Link href="/" className="btn-primary">العودة للرئيسية</Link>
    </main>
  );
}
