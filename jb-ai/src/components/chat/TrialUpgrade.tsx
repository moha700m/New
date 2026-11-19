"use client";
import { Bot, Check, Code2, Flame, ImageIcon, Brain, Send, Sparkles, Wallet } from "lucide-react";

export interface TrialInfo {
  used: number;
  limit: number;
  remaining: number;
  capReached: boolean;
  enabled: boolean;
  priceUsd: number;
  creditLabel: string;
  telegramUrl: string;
  listTitle?: string;
  imagesUsed?: number;
  imagesLimit?: number;
  imagesRemaining?: number;
}

const BENEFITS = [
  { icon: Code2, text: "أقوى نماذج البرمجة" },
  { icon: Brain, text: "نماذج التفكير العميق" },
  { icon: ImageIcon, text: "صور بدون قيود +١٨ وبدون حد" },
  { icon: Bot, text: "وكيل يبني المواقع وينشرها لك" },
  { icon: Flame, text: "كل النماذج بدون قيود +١٨" },
];

const safeUrl = (u: string) => (/^https:\/\//.test(u) ? u : "https://t.me/Justoio");

/** Full upgrade card — shown instead of the composer when the free messages are used up (or today's trial budget is spent). */
export function TrialUpgradeCard({ t, reason }: { t: TrialInfo; reason: "exhausted" | "cap" }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-b from-amber-500/[0.12] via-ink-850 to-ink-850 p-5 shadow-2xl sm:p-6" data-testid="trial-upgrade-card">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-300">
        <Sparkles size={16} /> {reason === "cap" ? "التجربة المجانية وصلت حدّها اليوم" : "خلصت رسائلك المجانية"}
      </div>
      <h2 className="mt-2 text-[22px] font-bold leading-9 text-white">تبي تستفيد من أقوى النماذج؟</h2>
      <p className="mt-1 text-[15px] leading-7 text-slate-300">برمجة، تفكير، صور، ووكيل يبني وينشر المواقع — كله بدون قيود +١٨.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {BENEFITS.map((b) => (
          <li key={b.text} className="flex items-center gap-2.5 rounded-xl bg-ink-800/70 px-3 py-2.5 text-[14px] text-slate-100">
            <b.icon size={16} className="shrink-0 text-amber-300" /> {b.text}
          </li>
        ))}
        <li className="flex items-center gap-2.5 rounded-xl bg-ink-800/70 px-3 py-2.5 text-[14px] text-slate-100">
          <Wallet size={16} className="shrink-0 text-amber-300" /> ومعه {t.creditLabel}
        </li>
      </ul>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-slate-400">الاشتراك</div>
          <div className="text-[34px] font-extrabold leading-none text-white" data-testid="trial-price">
            ${t.priceUsd}
          </div>
        </div>
        <div className="flex items-center gap-1 text-[12px] text-slate-400">
          <Check size={14} className="text-emerald-400" /> يتفعّل لك بعد التواصل
        </div>
      </div>
      <a href={safeUrl(t.telegramUrl)} target="_blank" rel="noopener noreferrer" className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-3.5 text-[16px] font-bold text-ink-950 transition hover:bg-amber-300" data-testid="trial-subscribe">
        <Send size={18} /> اشترك الحين
      </a>
      <p className="mt-2 text-center text-[12px] text-slate-400">للاشتراك تواصل معي على تلقرام</p>
    </div>
  );
}

/** «باقي لك صورتين» / «صورة وحدة» / «خلصت صورك» */
export function imagesLeftLabel(n: number) {
  if (n <= 0) return "خلصت صورك المجانية";
  if (n === 1) return "باقي لك صورة وحدة";
  if (n === 2) return "باقي لك صورتين";
  return `باقي لك ${n} صور`;
}

/** Small, subtle bar above the composer for trial accounts: remaining messages + a short upgrade line. */
export function TrialBar({ t }: { t: TrialInfo }) {
  const low = t.remaining <= 2;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850/80 px-3 py-2 text-[13px]" data-testid="trial-bar">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${low ? "bg-amber-500/15 text-amber-300" : "bg-ink-700 text-slate-200"}`}>
        باقي لك {t.remaining} من {t.limit} رسايل
      </span>
      {(t.imagesLimit ?? 0) > 0 && (
        <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[12px] font-semibold text-rose-200" data-testid="trial-images-left">
          {imagesLeftLabel(t.imagesRemaining ?? 0)}
        </span>
      )}
      <span className="hidden min-w-0 truncate text-slate-400 sm:inline">أقوى النماذج + وكيل + صور بـ ${t.priceUsd}</span>
      <a href={safeUrl(t.telegramUrl)} target="_blank" rel="noopener noreferrer" className="ms-auto shrink-0 font-semibold text-amber-300 hover:text-amber-200">
        اشترك
      </a>
    </div>
  );
}
