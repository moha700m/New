import Link from "next/link";
import { Logo } from "./Logo";

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <Link href="/" aria-label="Agentsii — الصفحة الرئيسية">
        <Logo />
      </Link>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-center text-xs text-white/35 sm:px-6">
      © {new Date().getFullYear()} Agentsii. جميع الحقوق محفوظة.
    </footer>
  );
}
