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
      setMsg("Missing verification token.");
      return;
    }
    api("/api/auth/verify", { body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMsg(e.message);
      });
  }, [token]);
  if (state === "pending") return <p className="text-sm text-slate-400">Verifying…</p>;
  if (state === "ok") return <p className="text-sm text-slate-300">Your email is verified. <Link className="text-brand-400" href="/">Start chatting →</Link></p>;
  return <p className="text-sm text-red-300">{msg}</p>;
}

export default function VerifyPage() {
  return (
    <AuthShell title="Email verification">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
