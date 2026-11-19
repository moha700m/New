"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/components/api";
import { AuthShell, FormError } from "@/components/auth/AuthShell";

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/auth/login", { body: { email, password } });
          const next = sp.get("next");
          window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <FormError error={error} />
      <div>
        <label className="label" htmlFor="email">البريد الإلكتروني</label>
        <input id="email" dir="ltr" className="input text-start" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="password">كلمة المرور</label>
          <Link href="/forgot-password" className="mb-1 text-xs text-brand-400">نسيت كلمة المرور؟</Link>
        </div>
        <input id="password" dir="ltr" className="input text-start" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</button>
    </form>
  );
}

export default function LoginPage() {
  const [registrationOpen, setRegistrationOpen] = useState(false);
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => setRegistrationOpen(Boolean(c?.site?.registrationOpen || c?.trialEnabled)))
      .catch(() => {});
  }, []);
  return (
    <AuthShell
      title="أهلًا بعودتك"
      subtitle={registrationOpen ? "سجّل دخولك لمتابعة محادثاتك." : "الموقع خاص — سجّل دخولك للمتابعة."}
      footer={registrationOpen ? <>ليس لديك حساب؟ <Link href="/register" className="font-semibold text-brand-400" data-testid="trial-register-link">جرّب مجانًا</Link></> : undefined}
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
