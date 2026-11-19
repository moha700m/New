"use client";
import { Check, ChevronDown, Flame, Gift, Lock, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveModel } from "../useLiveConfig";
import { CapabilityIcons, isFreeModel, isRegularModel, isUncensoredModel } from "./ModelSelector";

const TABS = [
  { key: "standard", label: "النماذج", icon: Sparkles, test: isRegularModel, tint: "text-brand-400", on: "bg-ink-700 text-white", note: null as string | null },
  { key: "uncensored", label: "بدون فلترة", icon: Flame, test: isUncensoredModel, tint: "text-rose-400", on: "bg-rose-500/15 text-rose-200", note: "ترد بدون قيود المحتوى المعتادة" },
  { key: "free", label: "مجانية", icon: Gift, test: isFreeModel, tint: "text-emerald-400", on: "bg-emerald-500/15 text-emerald-200", note: "ما تخصم من رصيد Venice" },
] as const;

const GROUPS: { key: LiveModel["category"]; label: string }[] = [
  { key: "TEXT", label: "عام" },
  { key: "REASONING", label: "تفكير واستدلال" },
  { key: "CODE", label: "برمجة" },
  { key: "VISION", label: "رؤية وتحليل الصور" },
  { key: "IMAGE", label: "توليد الصور" },
];

/** One model picker (Claude-style) with three tabs: النماذج / بدون فلترة / مجانية. */
export function ModelPicker({ models, value, onChange, defaultId, signedIn, title }: { models: LiveModel[]; value: string | null; onChange: (id: string) => void; defaultId: string | null; signedIn: boolean; title?: string | null }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === (value ?? defaultId));
  const currentTab = TABS.find((t) => current && t.test(current)) ?? TABS[0];
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(currentTab.key);
  const tabs = TABS.filter((t) => models.some(t.test));
  const T = TABS.find((t) => t.key === tab) ?? TABS[0];

  useEffect(() => {
    if (open) setTab(currentTab.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    // searching looks across all three lists
    const pool = s ? models : models.filter(T.test);
    return s ? pool.filter((m) => m.name.toLowerCase().includes(s) || (m.description ?? "").toLowerCase().includes(s)) : pool;
  }, [models, q, T]);

  const Icon = currentTab.icon;
  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        className="flex h-9 max-w-[200px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-slate-100 hover:bg-ink-800 sm:max-w-xs"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="model-selector"
      >
        <Icon size={15} className={`shrink-0 ${currentTab.tint}`} />
        <span className="truncate" dir="auto">{current ? current.name : models.length ? "اختر نموذجًا" : "لا توجد نماذج"}</span>
        <ChevronDown size={15} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-40 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl sm:absolute sm:inset-x-auto sm:start-0 sm:top-full sm:mt-1 sm:w-[400px]" data-testid="model-panel">
          {tabs.length > 1 && (
            <div className="flex gap-1 border-b border-ink-700 p-1.5" role="tablist">
              {tabs.map((t) => {
                const TI = t.icon;
                const n = models.filter(t.test).length;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => {
                      setTab(t.key);
                      setQ("");
                    }}
                    className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-[13px] font-medium ${tab === t.key ? t.on : "text-slate-400 hover:bg-ink-800"}`}
                    data-testid={`tab-${t.key}`}
                  >
                    <TI size={14} className={t.tint} /> {t.label} <span className="text-[10px] opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
          {title && (
            <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5 text-[14px] font-bold text-rose-200" data-testid="trial-models-title">
              <Flame size={15} className="text-rose-400" /> {title}
            </div>
          )}
          <div className={`relative border-b border-ink-700 p-2 ${title ? "hidden" : ""}`}>
            <Search size={14} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input py-1.5 ps-8" placeholder="ابحث في كل النماذج…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {T.note && !q && !title && <div className="px-3 pt-2 text-[11px] text-slate-500">{T.note}</div>}
          <div className="max-h-[58vh] overflow-y-auto p-1.5" role="listbox">
            {!filtered.length && <p className="p-3 text-sm text-slate-400">لا توجد نماذج مطابقة.</p>}
            {GROUPS.map((g) => {
              const list = filtered.filter((m) => m.category === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="mb-1">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-slate-500">{g.label}</div>
                  {list.map((m) => {
                    const locked = signedIn && !m.allowed;
                    const mt = TABS.find((t) => t.test(m));
                    return (
                      <button
                        key={m.id}
                        role="option"
                        aria-selected={m.id === current?.id}
                        disabled={locked}
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                          setQ("");
                        }}
                        className={`flex min-h-[44px] w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start ${locked ? "cursor-not-allowed opacity-60" : "hover:bg-ink-700"} ${m.id === current?.id ? "bg-ink-800" : ""}`}
                        title={m.description ?? undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {q && mt && mt.key !== "standard" && <mt.icon size={12} className={mt.tint} />}
                            <span className="truncate text-sm font-medium"><bdi>{m.name}</bdi></span>
                            {m.id === defaultId && <span className="badge bg-brand-500/15 text-brand-400">الافتراضي</span>}
                            <CapabilityIcons m={m} />
                          </div>
                          {m.description && <div dir="auto" className="line-clamp-1 text-xs text-slate-500">{m.description}</div>}
                        </div>
                        {locked ? (
                          <a href="https://t.me/Justoio" target="_blank" rel="noopener noreferrer" className="badge mt-0.5 bg-amber-400/15 text-amber-300" onClick={(e) => e.stopPropagation()}>
                            <Lock size={10} /> اشترك
                          </a>
                        ) : m.id === current?.id ? (
                          <Check size={16} className="mt-0.5 text-brand-400" />
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
