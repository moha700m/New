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
  const [mode, setMode] = useState<"loading" | "open" | "owner" | "trial" | "soon">("loading");
  const [sent, setSent] = useState<null | boolean>(null);
  const [counts, setCounts] = useState<{ messages: number; images: number }>({ messages: 5, images: 2 });
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => {
        if (c?.trialCounts) setCounts(c.trialCounts);
        if (c?.site?.registrationOpen) setMode("open");
        else if (c?.ownerSignupOpen) setMode("owner");
        else if (c?.trialSignupOpen) setMode("trial");
        else if (c?.trialEnabled) setMode("soon");
        else window.location.replace("/login");
      })
      .catch(() => setMode("open"));
  }, []);
  if (mode === "loading") return null;
  const owner = mode === "owner";
  const trial = mode === "trial" || mode === "soon";
  if (sent !== null)
    return (
      <AuthShell title="تحقّق من بريدك ✉️" subtitle="أرسلنا لك رابط تأكيد. افتحه وتقدر تبدأ تجربتك المجانية على طول.">
        <div className="space-y-3 text-sm leading-7 text-slate-300" data-testid="trial-check-email">
          <p>ما وصلك؟ شيّك على مجلد «غير المرغوب» (Spam).</p>
          <a href="/" className="btn-primary w-full justify-center">متابعة</a>
        </div>
      </AuthShell>
    );
  if (mode === "soon")
    return (
      <AuthShell title="التجربة المجانية تفتح قريب" subtitle="نجهّز التسجيل الحين — جرّب بعد شوي." footer={<>عندك حساب؟ <Link href="/login" className="text-brand-400">سجّل دخولك</Link></>}>
        <a href="https://t.me/Justoio" target="_blank" rel="noopener noreferrer" className="btn-primary w-full justify-center">تواصل على تلقرام</a>
      </AuthShell>
    );
  return (
    <AuthShell
      title={owner ? "إنشاء حساب المالك" : trial ? "جرّب «محمد | التقني» مجانًا" : "أنشئ حسابك"}
      subtitle={owner ? "الموقع خاص. التسجيل متاح لبريد المالك فقط، ويُقفل تلقائيًا بعد إنشاء الحساب." : trial ? `عندك ${trialOffer(counts)} مجانية بنماذج بدون قيود +١٨. سجّل بإيميلك الحقيقي وأكّده، وكل شخص له حساب واحد بس.` : "مجاني دائمًا، ويمكنك الترقية في أي وقت."}
      footer={trial ? <>عندك حساب؟ <Link href="/login" className="text-brand-400">سجّل دخولك</Link></> : <>لديك حساب؟ <Link href="/login" className="text-brand-400">تسجيل الدخول</Link></>}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ trial?: boolean; verificationEmailSent?: boolean }>("/api/auth/register", { body: { name: name || undefined, email, password } });
            if (r?.trial && r.verificationEmailSent) setSent(true);
            else window.location.href = "/";
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <div>
          <label className="label" htmlFor="name">{trial ? "اسمك (مو ضروري)" : "الاسم (اختياري)"}</label>
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="email">{trial ? "إيميلك" : "البريد الإلكتروني"}</label>
          <input id="email" dir="ltr" className="input text-start" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">{trial ? "كلمة السر" : "كلمة المرور"}</label>
          <input id="password" dir="ltr" className="input text-start" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{trial ? "٨ حروف أو أكثر." : "٨ أحرف على الأقل."}</p>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? (trial ? "لحظة نسوي حسابك…" : "جارٍ إنشاء الحساب…") : owner ? "إنشاء الحساب" : trial ? "ابدأ تجربتك المجانية" : "سجّل مجانًا"}</button>
      </form>
    </AuthShell>
  );
}

const ar = (n: number) => n.toLocaleString("ar-SA");
/** «٥ رسايل وصورتين» — follows the admin trial settings. */
function trialOffer({ messages, images }: { messages: number; images: number }) {
  const m = messages === 1 ? "رسالة وحدة" : messages === 2 ? "رسالتين" : messages <= 10 ? `${ar(messages)} رسايل` : `${ar(messages)} رسالة`;
  if (images <= 0) return m;
  const i = images === 1 ? "صورة وحدة" : images === 2 ? "صورتين" : images <= 10 ? `${ar(images)} صور` : `${ar(images)} صورة`;
  return `${m} و${i}`;
}
