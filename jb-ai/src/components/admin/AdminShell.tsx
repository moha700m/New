"use client";
import { Activity, BarChart3, Boxes, Cpu, CreditCard, Gauge, LayoutGrid, Menu, MessageSquare, Route, Server, Settings2, ShieldCheck, Users, Wallet, X, Plug } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "../Logo";

export const NAV = [
  { href: "/admin", label: "نظرة عامة", icon: Gauge },
  { href: "/admin/users", label: "المستخدمون", icon: Users },
  { href: "/admin/providers", label: "مزوّدو الذكاء الاصطناعي", icon: Server },
  { href: "/admin/engines", label: "محركات الذكاء الاصطناعي", icon: Cpu },
  { href: "/admin/mcp", label: "الموصّلات و GitHub (الوكيل)", icon: Plug },
  { href: "/admin/models", label: "إدارة النماذج", icon: Boxes },
  { href: "/admin/catalog", label: "كتالوج النماذج", icon: LayoutGrid },
  { href: "/admin/routing", label: "قواعد التوجيه", icon: Route },
  { href: "/admin/usage", label: "استخدام الـ API", icon: BarChart3 },
  { href: "/admin/plans", label: "باقات الاشتراك", icon: Wallet },
  { href: "/admin/payments", label: "المدفوعات", icon: CreditCard },
  { href: "/admin/system", label: "إعدادات النظام", icon: Settings2 },
  { href: "/admin/audit", label: "الأمان وسجل التدقيق", icon: ShieldCheck },
];

export function AdminShell({ user, children }: { user: { email: string; role: string }; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-[100dvh]">
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-ink-700 bg-ink-950 transition-transform lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/admin"><Logo name="محمد | التقني · الإدارة" /></Link>
          <button className="btn-ghost p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="إغلاق القائمة"><X size={18} /></button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5">
          {NAV.map((n) => {
            const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-ink-700 text-white" : "text-slate-400 hover:bg-ink-800 hover:text-white"}`}>
                <n.icon size={16} /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-ink-700 p-3 text-xs text-slate-500">
          <p dir="ltr" className="truncate text-right">{user.email}</p>
          <p className="mt-0.5"><span className="badge bg-brand-500/15 text-brand-400">{({ OWNER: "المالك", ADMIN: "مسؤول", USER: "مستخدم" } as Record<string, string>)[user.role] ?? user.role}</span></p>
          <Link href="/" className="btn-outline mt-3 w-full py-1.5"><MessageSquare size={14} /> فتح المحادثة</Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-ink-700 bg-ink-950/90 px-3 backdrop-blur lg:hidden">
          <button className="btn-ghost p-1.5" onClick={() => setOpen(true)} aria-label="فتح القائمة"><Menu size={18} /></button>
          <span className="text-sm font-medium">لوحة التحكم</span>
          <Activity size={14} className="ms-auto text-emerald-400" />
        </div>
        <div className="mx-auto max-w-7xl p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
