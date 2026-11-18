"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Field, OnOff, PageHeader, useAction, useAdmin } from "@/components/admin/ui";
import { Toggle } from "@/components/ui/Toggle";

interface S { siteName: string; tagline: string; registrationOpen: boolean; requireEmailVerification: boolean; systemPrompt: string; maxHistoryMessages: number; chatRateLimitPerMinute: number; maintenanceMode: boolean; supportEmail: string }
interface Env { mailerConfigured: boolean; appUrl: string | null; ownerEmailConfigured: boolean; encryptionKeyConfigured: boolean; nodeEnv: string }

export default function SystemPage() {
  const { data, reload } = useAdmin<{ settings: S; environment: Env }>("/api/admin/settings");
  const { run, busy } = useAction();
  const [s, setS] = useState<S | null>(null);
  useEffect(() => setS(data?.settings ?? null), [data]);
  if (!s || !data) return <p className="text-slate-400">Loading…</p>;
  const env = data.environment;
  return (
    <>
      <PageHeader title="System Configuration" actions={<button className="btn-primary" disabled={busy === "s"} onClick={() => run("s", () => api("/api/admin/settings", { method: "PUT", body: s }), "Settings saved").then(() => reload())}>Save settings</button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site name"><input className="input" value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} /></Field>
            <Field label="Support email"><input className="input" value={s.supportEmail} onChange={(e) => setS({ ...s, supportEmail: e.target.value })} /></Field>
          </div>
          <Field label="Tagline (home screen)"><input className="input" value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} /></Field>
          <Field label="System prompt" hint="Sent as the system message on every chat request."><textarea className="input min-h-[120px]" value={s.systemPrompt} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max history messages per request"><input className="input" type="number" value={s.maxHistoryMessages} onChange={(e) => setS({ ...s, maxHistoryMessages: Number(e.target.value) })} /></Field>
            <Field label="Chat rate limit (requests / user / minute)"><input className="input" type="number" value={s.chatRateLimitPerMinute} onChange={(e) => setS({ ...s, chatRateLimitPerMinute: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle checked={s.registrationOpen} onChange={(v) => setS({ ...s, registrationOpen: v })} label="Registration open" />
            <Toggle checked={s.requireEmailVerification} onChange={(v) => setS({ ...s, requireEmailVerification: v })} label="Require email verification" hint={env.mailerConfigured ? undefined : "Inactive until SMTP is configured"} />
            <Toggle checked={s.maintenanceMode} onChange={(v) => setS({ ...s, maintenanceMode: v })} label="Maintenance mode" />
          </div>
        </div>
        <div className="card space-y-2 text-sm">
          <h2 className="font-semibold">Environment</h2>
          <p>Environment: <b>{env.nodeEnv}</b></p>
          <p>App URL: <span className="break-all text-slate-300">{env.appUrl ?? "not set"}</span></p>
          <p>Email (SMTP): <OnOff on={env.mailerConfigured} onLabel="configured" offLabel="not configured" /></p>
          <p>Encryption key: <OnOff on={env.encryptionKeyConfigured} onLabel="configured" offLabel="missing" /></p>
          <p>Owner email: <OnOff on={env.ownerEmailConfigured} onLabel="configured" offLabel="not set" /></p>
          <p className="pt-2 text-xs text-slate-500">Secrets (database URL, master encryption key, SMTP) live in the hosting platform&apos;s environment variables and are never exposed here.</p>
        </div>
      </div>
    </>
  );
}
