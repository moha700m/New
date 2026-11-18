"use client";
import { useState } from "react";
import { api, fmtDate, money } from "@/components/api";
import { Field, OnOff, PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";

interface Data {
  status: { secretKeyConfigured: boolean; secretKeySource: string | null; secretKeyLast4: string | null; mode: string | null; webhookSecretConfigured: boolean; webhookSecretLast4: string | null; webhookUrl: string };
  payments: { id: string; createdAt: string; amountCents: number; currency: string; status: string; description: string | null; providerPaymentId: string; user: { email: string } }[];
  subscriptions: { id: string; status: string; interval: string; provider: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; user: { email: string }; plan: { name: string } }[];
  events: { id: string; type: string; processedAt: string; outcome: string | null }[];
}

export default function PaymentsAdmin() {
  const { data, reload } = useAdmin<Data>("/api/admin/payments");
  const { run, busy } = useAction();
  const [sk, setSk] = useState("");
  const [wh, setWh] = useState("");
  const s = data?.status;
  return (
    <>
      <PageHeader title="Payments" subtitle="Stripe hosted Checkout + Billing Portal. Subscriptions activate only from signature-verified webhooks." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">Connection</h2>
          <p>Secret key: <OnOff on={Boolean(s?.secretKeyConfigured)} onLabel={`configured ••••${s?.secretKeyLast4 ?? ""} (${s?.secretKeySource})`} offLabel="not configured" /> {s?.mode && <span className="badge ml-1 bg-brand-500/15 text-brand-400">{s.mode} mode</span>}</p>
          <p>Webhook secret: <OnOff on={Boolean(s?.webhookSecretConfigured)} onLabel={`configured ••••${s?.webhookSecretLast4 ?? ""}`} offLabel="not configured" /></p>
          <div className="rounded-lg bg-ink-800 p-3 text-xs text-slate-400">
            In Stripe Dashboard → Developers → Webhooks, add endpoint <code className="text-slate-200">{s?.webhookUrl}</code> with events: <code>checkout.session.completed</code>, <code>customer.subscription.created/updated/deleted</code>, <code>invoice.paid</code>, <code>invoice.payment_failed</code>. Paste its signing secret below.
          </div>
          <button className="btn-outline" disabled={busy === "test"} onClick={() => run("test", () => api<{ result: { ok: boolean; livemode?: boolean; error?: string; available?: string[] } }>("/api/admin/payments", { method: "POST" }), (r) => (r.result.ok ? `Stripe connected (${r.result.livemode ? "live" : "test"} mode). Balance: ${r.result.available?.join(", ")}` : `Stripe test failed: ${r.result.error}`))}>Test Stripe connection</button>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">Credentials (owner only)</h2>
          <Field label="Stripe secret key" hint="sk_test_… for sandbox, sk_live_… for production. Encrypted at rest."><input className="input font-mono" type="password" autoComplete="off" value={sk} onChange={(e) => setSk(e.target.value)} /></Field>
          <Field label="Webhook signing secret"><input className="input font-mono" type="password" autoComplete="off" value={wh} onChange={(e) => setWh(e.target.value)} placeholder="whsec_…" /></Field>
          <button className="btn-primary" disabled={!sk && !wh} onClick={() => run("save", () => api("/api/admin/payments", { method: "PUT", body: { ...(sk ? { secretKey: sk } : {}), ...(wh ? { webhookSecret: wh } : {}) } }), "Payment credentials saved").then(() => { setSk(""); setWh(""); reload(); })}>Save credentials</button>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Subscriptions</h2>
      <Table head={["User", "Plan", "Status", "Interval", "Period end", "Source"]} empty={!data?.subscriptions.length}>
        {data?.subscriptions.map((x) => <tr key={x.id}><td className="px-3 py-2">{x.user.email}</td><td className="px-3 py-2">{x.plan.name}</td><td className="px-3 py-2">{x.status.toLowerCase()}{x.cancelAtPeriodEnd && " (cancels)"}</td><td className="px-3 py-2">{x.interval.toLowerCase()}</td><td className="px-3 py-2">{fmtDate(x.currentPeriodEnd)}</td><td className="px-3 py-2">{x.provider}</td></tr>)}
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">Payments</h2>
      <Table head={["Date", "User", "Amount", "Status", "Reference"]} empty={!data?.payments.length}>
        {data?.payments.map((p) => <tr key={p.id}><td className="px-3 py-2">{fmtDate(p.createdAt, true)}</td><td className="px-3 py-2">{p.user.email}</td><td className="px-3 py-2">{money(p.amountCents, p.currency)}</td><td className="px-3 py-2">{p.status}</td><td className="px-3 py-2 font-mono text-xs">{p.providerPaymentId}</td></tr>)}
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">Verified webhook events</h2>
      <Table head={["Received", "Type", "Outcome", "Event ID"]} empty={!data?.events.length}>
        {data?.events.map((e) => <tr key={e.id}><td className="px-3 py-2 text-xs">{fmtDate(e.processedAt, true)}</td><td className="px-3 py-2 text-xs">{e.type}</td><td className="px-3 py-2 text-xs">{e.outcome}</td><td className="px-3 py-2 font-mono text-xs">{e.id}</td></tr>)}
      </Table>
    </>
  );
}
