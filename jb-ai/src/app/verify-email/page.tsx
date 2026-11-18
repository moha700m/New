"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/components/api";
import { AuthShell } from "@/components/auth/AuthShell";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!token) {
      setState("error");
      setMsg("رابط التأكيد غير مكتمل.");
      return;
    }
    api("/api/auth/verify", { body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMsg(e.message);
      });
  }, [token]);
  if (state === "pending") return <p className="text-sm text-slate-400">جارٍ التأكيد…</p>;
  if (state === "ok") return <p className="text-sm text-slate-300">تم تأكيد بريدك الإلكتروني. <Link className="text-brand-400" href="/">ابدأ المحادثة ←</Link></p>;
  return <p className="text-sm text-red-300">{msg}</p>;
}

export default function VerifyPage() {
  return (
    <AuthShell title="تأكيد البريد الإلكتروني">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
