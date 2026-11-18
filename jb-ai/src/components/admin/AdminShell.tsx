"use client";
import { Activity, BarChart3, Boxes, Cpu, CreditCard, Gauge, LayoutGrid, Menu, MessageSquare, Route, Server, Settings2, ShieldCheck, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "../Logo";

export const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/providers", label: "AI Providers", icon: Server },
  { href: "/admin/engines", label: "AI Engines", icon: Cpu },
  { href: "/admin/models", label: "Model Management", icon: Boxes },
  { href: "/admin/catalog", label: "Model Catalog", icon: LayoutGrid },
  { href: "/admin/routing", label: "Routing Rules", icon: Route },
  { href: "/admin/usage", label: "API Usage", icon: BarChart3 },
  { href: "/admin/plans", label: "Subscription Plans", icon: Wallet },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/system", label: "System Configuration", icon: Settings2 },
  { href: "/admin/audit", label: "Security & Audit Logs", icon: ShieldCheck },
];

export function AdminShell({ user, children }: { user: { email: string; role: string }; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-[100dvh]">
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-700 bg-ink-950 transition-transform lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/admin"><Logo name="JB AI Admin" /></Link>
          <button className="btn-ghost p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
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
          <p className="truncate">{user.email}</p>
          <p className="mt-0.5"><span className="badge bg-brand-500/15 text-brand-400">{user.role}</span></p>
          <Link href="/" className="btn-outline mt-3 w-full py-1.5"><MessageSquare size={14} /> Open chat</Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-ink-700 bg-ink-950/90 px-3 backdrop-blur lg:hidden">
          <button className="btn-ghost p-1.5" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="text-sm font-medium">Admin</span>
          <Activity size={14} className="ml-auto text-emerald-400" />
        </div>
        <div className="mx-auto max-w-7xl p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
