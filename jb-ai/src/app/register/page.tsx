"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/components/api";
import { AuthShell, FormError } from "@/components/auth/AuthShell";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Create your account" subtitle="Free forever. Upgrade any time." footer={<>Already have an account? <Link href="/login" className="text-brand-400">Log in</Link></>}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/auth/register", { body: { name: name || undefined, email, password } });
            window.location.href = "/";
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <div>
          <label className="label" htmlFor="name">Name (optional)</label>
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating account…" : "Sign up free"}</button>
      </form>
    </AuthShell>
  );
}
