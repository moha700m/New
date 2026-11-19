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
    <AuthShell title="نسيت كلمة السر؟" subtitle="اكتب إيميلك ونرسل لك رابط تغيّر فيه كلمة السر." footer={<Link href="/login" className="text-brand-400">ارجع لتسجيل الدخول</Link>}>
      {sent ? (
        <p className="text-sm text-slate-300">أرسلنا رابط تغيير كلمة السر على <b><bdi dir="ltr">{email}</bdi></b>. الرابط يشتغل ساعة وحدة. إذا ما لقيت الإيميل شوف مجلد الغير مرغوب (Spam).</p>
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
            <label className="label" htmlFor="email">إيميلك</label>
            <input id="email" dir="ltr" className="input text-start" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary w-full">أرسل لي الرابط</button>
          <p className="text-center text-xs text-slate-400">إذا ما لقيت الإيميل شوف مجلد الغير مرغوب (Spam)</p>
        </form>
      )}
    </AuthShell>
  );
}
