"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtDate, fmtNum, money } from "@/components/api";
import { Logo } from "@/components/Logo";
import { useToast } from "@/components/ui/Toast";

interface Me {
  user: { id: string; email: string; name: string | null; emailVerifiedAt: string | null; role: string } | null;
  plan: { key: string; name: string; dailyMessageLimit: number | null; monthlyMessageLimit: number | null; monthlyTokenLimit: number | null };
  subscription: { status: string; interval: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  usage: { messagesToday: number; messagesThisMonth: number; tokensThisMonth: number };
}

const TABS = ["profile", "billing", "usage", "account"] as const;

function SettingsInner() {
  const sp = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>((sp.get("tab") as (typeof TABS)[number]) || "profile");
  const [me, setMe] = useState<Me | null>(null);
  const [payments, setPayments] = useState<{ id: string; amountCents: number; currency: string; status: string; description: string | null; createdAt: string }[]>([]);
  const [name, setName] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [delPw, setDelPw] = useState("");

  const load = () =>
    api<Me>("/api/auth/me").then((d) => {
      if (!d.user) window.location.href = "/login?next=/settings";
      setMe(d);
      setName(d.user?.name ?? "");
    });

  useEffect(() => {
    void load();
    api("/api/billing/payments").then((d) => setPayments(d.payments)).catch(() => {});
  }, []);

  // After checkout we wait for the signed webhook to activate the plan (never trust the redirect itself).
  useEffect(() => {
    if (sp.get("checkout") !== "success") return;
    toast("Payment received — activating your plan as soon as the payment provider confirms it…", "info");
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const d = await api<Me>("/api/auth/me");
      setMe(d);
      if (d.subscription?.status === "ACTIVE" || n > 20) {
        clearInterval(t);
        if (d.subscription?.status === "ACTIVE") toast(`${d.plan.name} plan is active.`, "ok");
        api("/api/billing/payments").then((x) => setPayments(x.payments)).catch(() => {});
      }
    }, 3000);
    return () => clearInterval(t);
  }, [sp, toast]);

  if (!me?.user) return <p className="p-8 text-center text-slate-400">Loading…</p>;
  const sub = me.subscription;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <Link href="/"><Logo /></Link>
        <Link href="/" className="btn-outline px-3 py-1.5">Back to chat</Link>
      </header>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-ink-700">
        {TABS.map((t) => (
          <button key={t} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? "border-brand-500 text-white" : "border-transparent text-slate-400 hover:text-white"}`} onClick={() => setTab(t)}>
            {t === "account" ? "Account & data" : t}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="mt-6 space-y-6">
          <div className="card space-y-4">
            <div>
              <label className="label">Email</label>
              <p className="text-sm">{me.user.email} {me.user.emailVerifiedAt ? <span className="badge ml-2 bg-emerald-500/15 text-emerald-300">Verified</span> : <span className="badge ml-2 bg-amber-500/15 text-amber-300">Unverified</span>}</p>
            </div>
            <div>
              <label className="label" htmlFor="nm">Display name</label>
              <div className="flex gap-2">
                <input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn-primary" onClick={() => api("/api/account", { method: "PATCH", body: { name } }).then(() => toast("Saved", "ok")).catch((e) => toast(e.message, "err"))}>Save</button>
              </div>
            </div>
          </div>
          <form
            className="card space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              api("/api/account", { method: "PATCH", body: { currentPassword: curPw, newPassword: newPw } })
                .then(() => { toast("Password changed", "ok"); setCurPw(""); setNewPw(""); })
                .catch((err) => toast(err.message, "err"));
            }}
          >
            <h2 className="font-semibold">Change password</h2>
            <input className="input" type="password" placeholder="Current password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
            <input className="input" type="password" placeholder="New password (min 8 characters)" autoComplete="new-password" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
            <button className="btn-primary">Update password</button>
          </form>
        </div>
      )}

      {tab === "billing" && (
        <div className="mt-6 space-y-6">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-400">Current plan</p>
                <p className="text-xl font-semibold">{me.plan.name}</p>
                {sub && (
                  <p className="mt-1 text-sm text-slate-400">
                    Status: <b className="text-slate-200">{sub.status.toLowerCase()}</b> · {sub.interval === "YEAR" ? "Yearly" : "Monthly"}
                    {sub.currentPeriodEnd && <> · {sub.cancelAtPeriodEnd ? "Ends" : "Renews"} {fmtDate(sub.currentPeriodEnd)}</>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/plans" className="btn-primary">{me.plan.key === "free" ? "Upgrade" : "Change plan"}</Link>
                {sub && sub.status === "ACTIVE" && (
                  <>
                    <button className="btn-outline" onClick={() => api<{ url: string }>("/api/billing/portal", { method: "POST" }).then((d) => (window.location.href = d.url)).catch((e) => toast(e.message, "err"))}>
                      Manage billing
                    </button>
                    <button
                      className="btn-outline"
                      onClick={() =>
                        api("/api/billing/cancel", { body: { cancel: !sub.cancelAtPeriodEnd } })
                          .then(() => { toast(sub.cancelAtPeriodEnd ? "Subscription resumed" : "Subscription will end at period end", "ok"); void load(); })
                          .catch((e) => toast(e.message, "err"))
                      }
                    >
                      {sub.cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <h2 className="mb-3 font-semibold">Payment history</h2>
            {!payments.length ? (
              <p className="text-sm text-slate-400">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-t border-ink-700"><td className="py-2">{fmtDate(p.createdAt)}</td><td>{p.description}</td><td>{money(p.amountCents, p.currency)}</td><td className="capitalize">{p.status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["Messages today", me.usage.messagesToday, me.plan.dailyMessageLimit],
            ["Messages this month", me.usage.messagesThisMonth, me.plan.monthlyMessageLimit],
            ["Tokens this month", me.usage.tokensThisMonth, me.plan.monthlyTokenLimit],
          ].map(([label, v, limit]) => (
            <div key={label as string} className="card">
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{fmtNum(v as number)}</p>
              <p className="text-xs text-slate-500">{limit == null ? "No limit" : `of ${fmtNum(limit as number)}`}</p>
              {limit != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-ink-600"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, ((v as number) / Math.max(1, limit as number)) * 100)}%` }} /></div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "account" && (
        <div className="mt-6 space-y-6">
          <div className="card">
            <h2 className="font-semibold">Your data</h2>
            <p className="mt-1 text-sm text-slate-400">Conversations are private to your account and stored encrypted in transit. Delete individual chats from the sidebar.</p>
            <button className="btn-outline mt-3" onClick={() => api("/api/auth/logout", { method: "POST" }).then(() => (window.location.href = "/"))}>Log out</button>
          </div>
          <div className="card border-red-500/30">
            <h2 className="font-semibold text-red-300">Delete account</h2>
            <p className="mt-1 text-sm text-slate-400">Permanently deletes your account, conversations, files and usage history. Active subscriptions are canceled. This cannot be undone.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className="input" type="password" placeholder="Confirm with your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
              <button
                className="btn-danger whitespace-nowrap"
                disabled={!delPw}
                onClick={() => {
                  if (!confirm("Permanently delete your account and all data?")) return;
                  api("/api/account", { method: "DELETE", body: { password: delPw } }).then(() => (window.location.href = "/")).catch((e) => toast(e.message, "err"));
                }}
              >
                Delete my account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
