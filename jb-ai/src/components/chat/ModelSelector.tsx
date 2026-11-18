"use client";
import { Brain, Check, ChevronDown, Code2, Eye, Globe, ImageIcon, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveModel } from "../useLiveConfig";

const GROUPS: { key: LiveModel["category"]; label: string }[] = [
  { key: "TEXT", label: "General" },
  { key: "REASONING", label: "Reasoning" },
  { key: "CODE", label: "Coding" },
  { key: "VISION", label: "Vision" },
  { key: "IMAGE", label: "Image generation" },
];

export function CapabilityIcons({ m }: { m: LiveModel }) {
  const c = m.capabilities;
  return (
    <span className="flex items-center gap-1 text-slate-500">
      {c.reasoning && <Brain size={12} aria-label="Reasoning" />}
      {c.code && <Code2 size={12} aria-label="Code" />}
      {c.vision && <Eye size={12} aria-label="Vision" />}
      {c.webSearch && <Globe size={12} aria-label="Web search" />}
      {c.imageGeneration && <ImageIcon size={12} aria-label="Image generation" />}
    </span>
  );
}

export function ModelSelector({ models, value, onChange, defaultId, signedIn }: { models: LiveModel[]; value: string | null; onChange: (id: string) => void; defaultId: string | null; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value) ?? models.find((m) => m.id === defaultId);

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
        className="flex max-w-[220px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-200 hover:bg-ink-700 sm:max-w-xs"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="model-selector"
      >
        <Sparkles size={15} className="shrink-0 text-brand-400" />
        <span className="truncate">{current ? current.name : models.length ? "Choose a model" : "No models available"}</span>
        <ChevronDown size={15} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-2xl">
          <div className="border-b border-ink-700 p-2">
            <input className="input py-1.5" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox">
            {!filtered.length && <p className="p-3 text-sm text-slate-400">No models match.</p>}
            {GROUPS.map((g) => {
              const list = filtered.filter((m) => m.category === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="mb-1">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.label}</div>
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
                        className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left ${locked ? "cursor-not-allowed opacity-60" : "hover:bg-ink-700"}`}
                        title={m.description ?? undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{m.name}</span>
                            {m.id === defaultId && <span className="badge bg-brand-500/15 text-brand-400">Default</span>}
                            <CapabilityIcons m={m} />
                          </div>
                          {m.description && <div className="line-clamp-1 text-xs text-slate-500">{m.description}</div>}
                        </div>
                        {locked ? (
                          <Link href="/plans" className="badge mt-0.5 bg-amber-400/15 text-amber-300" onClick={(e) => e.stopPropagation()}>
                            <Lock size={10} /> Upgrade
                          </Link>
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
