"use client";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";

/** Paste a remote MCP URL or a JSON MCP config → one-tap connect (the service's own login page; no tokens). */
export function AddConnector({ back }: { back: string }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ kind: "connect" | "message"; href?: string; name?: string; note?: string; message?: string }>("/api/admin/mcp/import", { body: { input: v, back } });
      if (r.kind === "connect" && r.href) {
        if (r.note) {
          setMsg({ ok: true, text: r.note });
          setTimeout(() => (window.location.href = r.href!), 2200);
        } else window.location.href = r.href;
        return;
      }
      setMsg({ ok: false, text: r.message ?? "ما قدرت أربطه" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <div data-testid="add-connector">
      <textarea
        dir="ltr"
        rows={v.includes("\n") ? 5 : 2}
        className="input resize-none font-mono text-xs"
        placeholder={'https://example.com/mcp\nأو الصق إعدادات MCP (JSON)'}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button className="btn-primary mt-2 w-full justify-center py-2.5" disabled={!v.trim() || busy} onClick={go}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} ربط
      </button>
      {msg && <p className={`mt-2 text-xs leading-6 ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
