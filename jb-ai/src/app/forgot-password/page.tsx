"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/components/api";
import { AuthShell, FormError } from "@/components/auth/AuthShell";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure reset link." footer={<Link href="/login" className="text-brand-400">Back to log in</Link>}>
      {sent ? (
        <p className="text-sm text-slate-300">If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 1 hour.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/api/auth/forgot", { body: { email } });
              setSent(true);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <FormError error={error} />
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary w-full">Send reset link</button>
        </form>
      )}
    </AuthShell>
  );
}
