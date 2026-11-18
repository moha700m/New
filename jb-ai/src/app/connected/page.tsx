"use client";
import { CheckCircle2, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function Result() {
  const sp = useSearchParams();
  const ok = sp.get("ok") === "1";
  const name = sp.get("name") ?? "";
  const msg = sp.get("msg");
  const tools = sp.get("tools");
  const b = sp.get("back") ?? "/";
  const back = b.startsWith("/") && !b.startsWith("//") ? b : "/";
  const sep = back.includes("?") ? "&" : "?";
  const target = ok ? `${back}${sep}connected=${encodeURIComponent(name)}` : back;

  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => window.location.replace(target), 1800);
    return () => clearTimeout(t);
  }, [ok, target]);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-850 p-7 text-center shadow-2xl" data-testid="connect-result">
      {ok ? <CheckCircle2 size={52} className="mx-auto text-emerald-400" /> : <XCircle size={52} className="mx-auto text-rose-400" />}
      <h1 className="mt-4 text-xl font-bold">{ok ? `تم ربط ${name} ✓` : `ما تم ربط ${name || "الموصّل"}`}</h1>
      {ok && tools && Number(tools) > 0 && <p className="mt-2 text-sm text-slate-400">{tools} أداة صارت جاهزة للوكيل</p>}
      {!ok && msg && (
        <p dir="auto" className="mt-3 rounded-lg bg-rose-500/10 p-3 text-sm leading-7 text-rose-200">
          {msg}
        </p>
      )}
      <a href={target} className="btn-primary mt-6 inline-flex w-full justify-center py-3">
        {ok ? "رجوع للمحادثة" : "رجوع"}
      </a>
    </div>
  );
}

export default function ConnectedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 p-4">
      <Suspense>
        <Result />
      </Suspense>
    </main>
  );
}
