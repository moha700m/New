"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { AuthShell, FormError } from "@/components/auth/AuthShell";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"loading" | "open" | "owner">("loading");
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => {
        if (c?.site?.registrationOpen) setMode("open");
        else if (c?.ownerSignupOpen) setMode("owner");
        else window.location.replace("/login");
      })
      .catch(() => setMode("open"));
  }, []);
  if (mode === "loading") return null;
  const owner = mode === "owner";
  return (
    <AuthShell
      title={owner ? "إنشاء حساب المالك" : "أنشئ حسابك"}
      subtitle={owner ? "الموقع خاص. التسجيل متاح لبريد المالك فقط، ويُقفل تلقائيًا بعد إنشاء الحساب." : "مجاني دائمًا، ويمكنك الترقية في أي وقت."}
      footer={<>لديك حساب؟ <Link href="/login" className="text-brand-400">تسجيل الدخول</Link></>}
    >
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
          <label className="label" htmlFor="name">الاسم (اختياري)</label>
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="email">البريد الإلكتروني</label>
          <input id="email" dir="ltr" className="input text-start" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">كلمة المرور</label>
          <input id="password" dir="ltr" className="input text-start" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">٨ أحرف على الأقل.</p>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? "جارٍ إنشاء الحساب…" : owner ? "إنشاء الحساب" : "سجّل مجانًا"}</button>
      </form>
    </AuthShell>
  );
}
