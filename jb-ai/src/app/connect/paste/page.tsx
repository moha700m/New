"use client";
import { ClipboardPaste, ExternalLink, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function Paste() {
  const sp = useSearchParams();
  const name = sp.get("name") ?? "الموصّل";
  const go = sp.get("go") ?? "";
  const b = sp.get("back") ?? "/";
  const back = b.startsWith("/") && !b.startsWith("//") ? b : "/";
  const safeGo = /^https:\/\//.test(go) ? go : "";
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pasteClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setUrl(t);
    } catch {
      /* clipboard blocked — the user pastes by hand */
    }
  }

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/oauth/mcp/paste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || "ما تم الربط");
      const q = new URLSearchParams({ ok: "1", name: j.name ?? name, back: j.back ?? back, tools: String(j.tools ?? 0) });
      window.location.replace(`/connected?${q}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-ink-600 bg-ink-850 p-6 shadow-2xl" data-testid="connect-paste">
      <h1 className="text-xl font-bold">ربط {name}</h1>
      <p className="mt-2 text-sm leading-7 text-slate-400">{name} ما يسمح يرجع لموقعك تلقائيًا، فالربط خطوتين:</p>
      <ol className="mt-4 space-y-4 text-[15px] leading-7">
        <li>
          <span className="font-semibold">١. سجّل دخولك ووافق</span>
          {safeGo ? (
            <a href={safeGo} target="_blank" rel="noopener noreferrer" className="btn-primary mt-2 flex w-full items-center justify-center gap-2 py-3" data-testid="paste-open">
              <ExternalLink size={17} /> افتح صفحة دخول {name}
            </a>
          ) : (
            <p className="mt-2 text-rose-300">رابط الدخول ناقص — ارجع واضغط «ربط» مرة ثانية.</p>
          )}
        </li>
        <li>
          <span className="font-semibold">٢. بعد الموافقة بتطلع صفحة ما تفتح (localhost) — هذا طبيعي.</span>
          <span className="block text-sm text-slate-400">انسخ العنوان كامل من شريط المتصفح، وارجع هنا والصقه:</span>
          <div className="mt-2 flex gap-2">
            <input
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8976/...?code=..."
              className="input min-w-0 flex-1 text-[16px]"
              data-testid="paste-input"
            />
            <button type="button" onClick={pasteClipboard} className="btn-ghost shrink-0 px-3" aria-label="لصق">
              <ClipboardPaste size={18} />
            </button>
          </div>
        </li>
      </ol>
      {err && (
        <p dir="auto" className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm leading-7 text-rose-200">
          {err}
        </p>
      )}
      <button type="button" disabled={!url.includes("code=") || busy} onClick={finish} className="btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3 disabled:opacity-50" data-testid="paste-finish">
        {busy && <Loader2 size={17} className="animate-spin" />} تم — اربط {name}
      </button>
      <a href={back} className="mt-3 block text-center text-sm text-slate-400">إلغاء</a>
    </div>
  );
}

export default function PastePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 p-4">
      <Suspense>
        <Paste />
      </Suspense>
    </main>
  );
}
