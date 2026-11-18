"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/components/api";
import { AuthShell, FormError } from "@/components/auth/AuthShell";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p className="text-sm text-slate-300">تم تحديث كلمة المرور. <Link href="/login" className="text-brand-400">سجّل دخولك</Link> بكلمة المرور الجديدة.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api("/api/auth/reset", { body: { token, password } });
          setDone(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <FormError error={error} />
      <div>
        <label className="label" htmlFor="pw">كلمة المرور الجديدة</label>
        <input id="pw" dir="ltr" className="input text-start" type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={!token}>تعيين كلمة المرور</button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthShell title="اختر كلمة مرور جديدة">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
