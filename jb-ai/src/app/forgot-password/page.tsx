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
    <AuthShell title="استعادة كلمة المرور" subtitle="سنرسل إلى بريدك رابطًا آمنًا لتعيين كلمة مرور جديدة." footer={<Link href="/login" className="text-brand-400">العودة لتسجيل الدخول</Link>}>
      {sent ? (
        <p className="text-sm text-slate-300">إذا كان هناك حساب مرتبط بالبريد <b><bdi dir="ltr">{email}</bdi></b> فسيصلك رابط الاستعادة قريبًا، وصلاحيته ساعة واحدة.</p>
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
            <label className="label" htmlFor="email">البريد الإلكتروني</label>
            <input id="email" dir="ltr" className="input text-start" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary w-full">إرسال رابط الاستعادة</button>
        </form>
      )}
    </AuthShell>
  );
}
