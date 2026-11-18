"use client";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, money } from "@/components/api";
import { Logo } from "@/components/Logo";
import { useToast } from "@/components/ui/Toast";

interface PlanInfo {
  id: string; key: string; name: string; description: string | null; features: string[] | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; isDefault: boolean;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [yearly, setYearly] = useState(false);
  const [me, setMe] = useState<{ user: unknown; plan?: { key: string } } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api<{ plans: PlanInfo[] }>("/api/plans").then((d) => setPlans(d.plans));
    api("/api/auth/me").then(setMe);
  }, []);

  async function buy(p: PlanInfo) {
    if (!me?.user) return (window.location.href = "/register");
    setBusy(p.key);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { planKey: p.key, interval: yearly ? "YEAR" : "MONTH" } });
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(null);
    }
  }

  return (
    <div className="min-h-[100dvh] px-4 pb-16">
      <header className="mx-auto flex max-w-5xl items-center justify-between py-5">
        <Link href="/"><Logo /></Link>
        <Link href="/" className="btn-outline px-3 py-1.5">Back to chat</Link>
      </header>
      <div className="mx-auto max-w-5xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Plans & pricing</h1>
        <p className="mt-2 text-slate-400">Start free. Upgrade for more messages, more models, web search and image generation.</p>
        <div className="mt-6 inline-flex rounded-lg border border-ink-600 bg-ink-850 p-1 text-sm">
          <button className={`rounded-md px-4 py-1.5 ${!yearly ? "bg-ink-600 text-white" : "text-slate-400"}`} onClick={() => setYearly(false)}>Monthly</button>
          <button className={`rounded-md px-4 py-1.5 ${yearly ? "bg-ink-600 text-white" : "text-slate-400"}`} onClick={() => setYearly(true)}>Yearly</button>
        </div>
      </div>
      <div className="mx-auto mt-8 grid max-w-5xl gap-4 md:grid-cols-3">
        {plans.map((p, i) => {
          const price = yearly ? p.priceYearlyCents : p.priceMonthlyCents;
          const current = me?.plan?.key === p.key;
          return (
            <div key={p.id} className={`card flex flex-col ${i === 1 ? "border-brand-500/60 shadow-[0_0_40px_-12px_rgba(91,140,255,0.5)]" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {i === 1 && <span className="badge bg-brand-500/20 text-brand-400">Popular</span>}
              </div>
              <p className="mt-1 text-sm text-slate-400">{p.description}</p>
              <div className="mt-4 text-3xl font-semibold">
                {price === 0 ? "Free" : money(price, p.currency)}
                {price > 0 && <span className="text-sm font-normal text-slate-400"> / {yearly ? "year" : "month"}</span>}
              </div>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {(p.features ?? []).map((f) => (
                  <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> {f}</li>
                ))}
              </ul>
              {current ? (
                <button className="btn-outline mt-6" disabled>Current plan</button>
              ) : p.isDefault || price === 0 ? (
                <Link href={me?.user ? "/" : "/register"} className="btn-outline mt-6">{me?.user ? "Included" : "Sign up free"}</Link>
              ) : (
                <button className="btn-primary mt-6" disabled={busy !== null} onClick={() => buy(p)}>{busy === p.key ? "Redirecting…" : `Upgrade to ${p.name}`}</button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-6 max-w-5xl text-center text-xs text-slate-500">Payments are processed securely by Stripe. We never see or store your card details. Cancel any time.</p>
    </div>
  );
}
