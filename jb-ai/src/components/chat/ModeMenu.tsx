"use client";
import { Brain, Check, ChevronDown, Code2, Eye, ImageIcon, MessageSquareText, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ModeKey = "text" | "reasoning" | "code" | "vision" | "image";
export interface ModeOption {
  key: ModeKey;
  modelId: string;
  modelName: string;
}

export const MODE_META: Record<ModeKey, { label: string; hint: string; icon: LucideIcon; tint: string }> = {
  text: { label: "نصوص", hint: "محادثة وكتابة", icon: MessageSquareText, tint: "text-slate-200" },
  reasoning: { label: "تفكير", hint: "تحليل أعمق خطوة بخطوة", icon: Brain, tint: "text-amber-300" },
  code: { label: "برمجة", hint: "كود ومراجعة وتصحيح", icon: Code2, tint: "text-emerald-300" },
  vision: { label: "رؤية", hint: "يقرأ الصور اللي ترفعها", icon: Eye, tint: "text-sky-300" },
  image: { label: "صور", hint: "يولّد صور من وصفك", icon: ImageIcon, tint: "text-fuchsia-300" },
};

/** Compact role picker next to the send button: each role switches the chat to the model the admin set for it. */
export function ModeMenu({ modes, active, onPick, disabled }: { modes: ModeOption[]; active: ModeKey | null; onPick: (m: ModeOption) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  if (!modes.length) return null;
  const cur = active ? MODE_META[active] : null;
  const CurIcon = cur?.icon ?? MessageSquareText;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`flex h-9 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition ${open ? "border-ink-400 bg-ink-700" : "border-ink-500 hover:bg-ink-700"} ${cur ? cur.tint : "text-slate-300"}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="اختر نوع المهمة"
        data-testid="mode-button"
      >
        <CurIcon size={15} />
        <span>{cur?.label ?? "مخصّص"}</span>
        <ChevronDown size={13} className={`opacity-60 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute bottom-full end-0 z-40 mb-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 p-1.5 shadow-2xl" role="menu" data-testid="mode-menu">
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-slate-500">نوع المهمة</div>
          {modes.map((m) => {
            const meta = MODE_META[m.key];
            const I = meta.icon;
            const on = active === m.key;
            return (
              <button
                key={m.key}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start ${on ? "bg-ink-700" : "hover:bg-ink-800"}`}
                onClick={() => {
                  setOpen(false);
                  onPick(m);
                }}
                data-testid={`mode-${m.key}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-800 ${meta.tint}`}>
                  <I size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-100">
                    {meta.label} <span className="text-[11px] font-normal text-slate-500">· {meta.hint}</span>
                  </span>
                  <span dir="ltr" className="block truncate text-right text-[11.5px] text-slate-400">{m.modelName}</span>
                </span>
                {on && <Check size={16} className="shrink-0 text-sky-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
