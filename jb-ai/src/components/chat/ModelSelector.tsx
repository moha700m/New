"use client";
import { Brain, Check, ChevronDown, Code2, Eye, Flame, Globe, ImageIcon, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveModel } from "../useLiveConfig";

/** Uncensored models live in their own picker («بدون فلترة»), separate from the regular list. */
export const isUncensoredModel = (m: LiveModel) => Boolean(m.capabilities.uncensored);

const GROUPS: { key: LiveModel["category"]; label: string }[] = [
  { key: "TEXT", label: "عام" },
  { key: "REASONING", label: "تفكير واستدلال" },
  { key: "CODE", label: "برمجة" },
  { key: "VISION", label: "رؤية وتحليل الصور" },
  { key: "IMAGE", label: "توليد الصور" },
];

export function CapabilityIcons({ m }: { m: LiveModel }) {
  const c = m.capabilities;
  return (
    <span className="flex items-center gap-1 text-slate-500">
      {c.reasoning && <Brain size={12} aria-label="تفكير" />}
      {c.code && <Code2 size={12} aria-label="برمجة" />}
      {c.vision && <Eye size={12} aria-label="رؤية" />}
      {c.webSearch && <Globe size={12} aria-label="بحث في الويب" />}
      {c.imageGeneration && <ImageIcon size={12} aria-label="توليد صور" />}
    </span>
  );
}

export function ModelSelector({
  models,
  value,
  onChange,
  defaultId,
  signedIn,
  variant = "standard",
}: {
  models: LiveModel[];
  value: string | null;
  onChange: (id: string) => void;
  defaultId: string | null;
  signedIn: boolean;
  variant?: "standard" | "uncensored";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const uncensored = variant === "uncensored";
  // `models` is already the list for this picker; the active model shows here only when it belongs to it.
  const active = value ?? defaultId;
  const current = models.find((m) => m.id === active);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? models.filter((m) => m.name.toLowerCase().includes(s) || (m.description ?? "").toLowerCase().includes(s)) : models;
  }, [models, q]);

  return (
    <div className="relative" ref={ref}>
      <button
        className={
          uncensored
            ? `flex max-w-[130px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium sm:max-w-xs ${current ? "border-rose-500/60 bg-rose-500/15 text-rose-200" : "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"}`
            : `flex max-w-[150px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium sm:max-w-xs ${current ? "border-brand-500/40 bg-ink-700/60 text-slate-100" : "border-transparent text-slate-300 hover:bg-ink-700"}`
        }
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={uncensored ? "uncensored-selector" : "model-selector"}
      >
        {uncensored ? <Flame size={15} className="shrink-0 text-rose-400" /> : <Sparkles size={15} className="shrink-0 text-brand-400" />}
        <span className="truncate">
          {current ? <bdi>{current.name}</bdi> : uncensored ? "بدون فلترة" : models.length ? "النماذج" : "لا توجد نماذج متاحة"}
        </span>
        <ChevronDown size={15} className={`shrink-0 ${uncensored ? "text-rose-400/80" : "text-slate-400"}`} />
      </button>
      {open && (
        <div
          className={`fixed inset-x-2 top-14 z-40 overflow-hidden rounded-xl border bg-ink-900 shadow-2xl sm:absolute sm:inset-x-auto sm:start-0 sm:top-full sm:mt-1 sm:w-[380px] ${uncensored ? "border-rose-500/40" : "border-ink-600"}`}
        >
          {uncensored && (
            <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <Flame size={14} className="shrink-0" />
              <span>نماذج بدون فلترة — ترد بدون قيود المحتوى المعتادة ({models.length} نموذج)</span>
            </div>
          )}
          <div className="border-b border-ink-700 p-2">
            <input className="input py-1.5" placeholder={uncensored ? "ابحث في النماذج بدون فلترة…" : "ابحث في النماذج…"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox">
            {!filtered.length && <p className="p-3 text-sm text-slate-400">لا توجد نماذج مطابقة.</p>}
            {GROUPS.map((g) => {
              const list = filtered.filter((m) => m.category === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="mb-1">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-slate-500">{g.label}</div>
                  {list.map((m) => {
                    const locked = signedIn && !m.allowed;
                    return (
                      <button
                        key={m.id}
                        role="option"
                        aria-selected={m.id === current?.id}
                        disabled={locked}
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                        }}
                        className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start ${locked ? "cursor-not-allowed opacity-60" : "hover:bg-ink-700"}`}
                        title={m.description ?? undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium"><bdi>{m.name}</bdi></span>
                            {m.id === defaultId && <span className="badge bg-brand-500/15 text-brand-400">الافتراضي</span>}
                            <CapabilityIcons m={m} />
                          </div>
                          {m.description && <div dir="auto" className="line-clamp-1 text-xs text-slate-500">{m.description}</div>}
                        </div>
                        {locked ? (
                          <Link href="/plans" className="badge mt-0.5 bg-amber-400/15 text-amber-300" onClick={(e) => e.stopPropagation()}>
                            <Lock size={10} /> ترقية
                          </Link>
                        ) : m.id === current?.id ? (
                          <Check size={16} className={`mt-0.5 ${uncensored ? "text-rose-400" : "text-brand-400"}`} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
