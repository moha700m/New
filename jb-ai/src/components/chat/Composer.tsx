"use client";
import { ArrowUp, Bot, Check, FileText, Globe, ImageIcon, Lightbulb, Loader2, Paperclip, Plug, Plus, Square, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "../ui/Toast";
import { ModeMenu, type ModeKey, type ModeOption } from "./ModeMenu";
import { filterMentions, MentionChip, MentionPopover, type MentionItem } from "./Mentions";

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  kind: string;
  previewUrl?: string;
}

export function Composer(props: {
  onSend: (text: string, attachments: PendingAttachment[], opts?: { mentions: MentionItem[] }) => void;
  /** @mention catalog (owner only); empty = mentions off */
  mentionItems?: MentionItem[];
  onMentionOpen?: () => void;
  /** role picker next to send (نصوص / تفكير / برمجة / رؤية / صور) */
  modes?: ModeOption[];
  activeMode?: ModeKey | null;
  onPickMode?: (m: ModeOption) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  think: boolean;
  setThink: (v: boolean) => void;
  thinkAvailable: boolean;
  search: boolean;
  setSearch: (v: boolean) => void;
  searchAvailable: boolean;
  searchLocked: boolean;
  uploadsAllowed: boolean;
  onRequireAuth?: () => void;
  autoFocus?: boolean;
  /** free-trial accounts: plain text chat only (no attach/agent/connectors menu) */
  plainChat?: boolean;
  imageMode?: boolean;
  onToggleImage?: () => void;
  agent?: boolean;
  setAgent?: (v: boolean) => void;
  onOpenConnectors?: () => void;
  connectorsCount?: number;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<PendingAttachment[]>([]);
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  // open @ autocomplete: the "@query" right before the caret
  const [mq, setMq] = useState<{ start: number; query: string } | null>(null);
  const [mActive, setMActive] = useState(0);
  const mentionList = mq && props.mentionItems?.length ? filterMentions(props.mentionItems, mq.query).slice(0, 30) : [];
  function detectMention(value: string, caret: number) {
    if (!props.mentionItems?.length) return setMq(null);
    const before = value.slice(0, caret);
    const m = /(^|[\s(«"'،,])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    if (m) {
      const start = caret - m[2]!.length - 1;
      setMq((old) => {
        if (!old) props.onMentionOpen?.();
        return { start, query: m[2]! };
      });
      setMActive(0);
    } else setMq(null);
  }
  function pickMention(it: MentionItem) {
    const ta = taRef.current;
    if (!mq) return;
    const caret = ta?.selectionStart ?? text.length;
    const next = (text.slice(0, mq.start) + text.slice(caret)).replace(/^\s+/, "");
    setText(next);
    setMentions((x) => (x.some((y) => y.key === it.key) ? x : [...x, it]));
    setMq(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = Math.min(mq.start, next.length);
      ta?.setSelectionRange(pos, pos);
    });
  }
  const [uploading, setUploading] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [text]);

  async function upload(files: FileList | File[]) {
    if (props.onRequireAuth) return props.onRequireAuth();
    if (!props.uploadsAllowed) return toast("رفع الملفات غير متاح في باقتك.", "err");
    for (const file of Array.from(files).slice(0, 8)) {
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "فشل رفع الملف");
        const a = data.attachment;
        setAtts((x) => [...x, { ...a, previewUrl: a.kind === "image" ? URL.createObjectURL(file) : undefined }]);
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function submit() {
    if (props.streaming || uploading) return;
    if (!text.trim() && !atts.length) return;
    // mentions travel in the text as "@Token" (kept on regenerate / edit; the server reads them from there)
    const tokens = mentions.map((m) => `@${m.token}`).filter((t) => !text.includes(t));
    props.onSend([tokens.join(" "), text.trim()].filter(Boolean).join(" "), atts, { mentions });
    setText("");
    setAtts([]);
    setMentions([]);
    setMq(null);
  }

  return (
    <div
      className="relative rounded-2xl border border-ink-500/70 bg-ink-850/90 shadow-[0_0_0_1px_rgba(91,140,255,0.06),0_10px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur focus-within:border-brand-500/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      {mq && props.mentionItems?.length ? <MentionPopover items={mentionList} active={mActive} query={mq.query} onHover={setMActive} onPick={pickMention} /> : null}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid="mention-chips">
          {mentions.map((m) => (
            <MentionChip key={m.key} it={m} onRemove={() => setMentions((x) => x.filter((y) => y.key !== m.key))} />
          ))}
        </div>
      )}
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {atts.map((a) => (
            <div key={a.id} className="group relative flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 py-1 ps-1 pe-2 text-xs">
              {a.previewUrl ? <img src={a.previewUrl} alt="" className="h-9 w-9 rounded object-cover" /> : <FileText size={18} className="ms-1 text-slate-400" />}
              <span className="max-w-[140px] truncate">{a.filename}</span>
              <button className="text-slate-400 hover:text-white" onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))} aria-label={`إزالة ${a.filename}`}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        onChange={(e) => {
          setText(e.target.value);
          detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => mq && detectMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setMq(null), 150)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void upload(files);
          }
        }}
        onKeyDown={(e) => {
          if (mq && mentionList.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setMActive((i) => (i + (e.key === "ArrowDown" ? 1 : mentionList.length - 1)) % mentionList.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pickMention(mentionList[mActive] ?? mentionList[0]!);
              return;
            }
          }
          if (mq && e.key === "Escape") {
            e.preventDefault();
            setMq(null);
            return;
          }
          if (e.key === "Backspace" && !text && mentions.length) {
            setMentions((x) => x.slice(0, -1));
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={props.placeholder ?? (props.mentionItems?.length ? "اسأل أي شيء — اكتب @ لأداة أو مكان نشر" : "اسألني أي شي")}
        dir="auto"
        className="block max-h-60 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] text-slate-100 outline-none placeholder:text-slate-500"
        data-testid="composer-input"
      />
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ""))} />
        <div className={`relative ${props.plainChat ? "hidden" : ""}`} ref={menuRef}>
          <button
            className={`flex h-9 w-9 items-center justify-center rounded-full border border-ink-500 text-slate-200 hover:bg-ink-700 ${menu ? "bg-ink-700" : ""}`}
            onClick={() => (props.onRequireAuth ? props.onRequireAuth() : setMenu((m) => !m))}
            aria-label="المزيد: إرفاق، صورة، وكيل، موصّلات"
            aria-expanded={menu}
            data-testid="plus-menu"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={19} className={`transition ${menu ? "rotate-45" : ""}`} />}
          </button>
          {menu && (
            <div className="absolute bottom-full start-0 z-30 mb-2 w-64 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 p-1.5 shadow-2xl" role="menu" data-testid="plus-panel">
              <MenuItem icon={Paperclip} label="إرفاق صور وملفات" onClick={() => { setMenu(false); fileRef.current?.click(); }} />
              {props.onToggleImage && <MenuItem icon={ImageIcon} label="إنشاء صورة" active={props.imageMode} onClick={() => { setMenu(false); props.onToggleImage!(); }} />}
              {props.setAgent && <MenuItem icon={Bot} label="وضع الوكيل" hint="يبني وينشر بالأدوات" active={props.agent} onClick={() => { setMenu(false); props.setAgent!(!props.agent); }} testid="agent-mode" />}
              {props.thinkAvailable && <MenuItem icon={Lightbulb} label="تفكير أعمق" active={props.think} onClick={() => { setMenu(false); props.setThink(!props.think); }} />}
              {props.searchAvailable && (
                <MenuItem icon={Globe} label="بحث في الويب" active={props.search} onClick={() => { setMenu(false); if (props.searchLocked) toast("البحث في الويب متاح في الباقات المدفوعة.", "info"); else props.setSearch(!props.search); }} />
              )}
              {props.onOpenConnectors && (
                <>
                  <div className="my-1 h-px bg-ink-700" />
                  <MenuItem icon={Plug} label="الموصّلات" hint={props.connectorsCount ? `${props.connectorsCount} مربوط` : "GitHub و Netlify و Supabase…"} onClick={() => { setMenu(false); props.onOpenConnectors!(); }} />
                </>
              )}
            </div>
          )}
        </div>
        {props.onOpenConnectors && (
          <button
            className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-slate-300 hover:bg-ink-700"
            onClick={props.onOpenConnectors}
            title="الموصّلات"
            data-testid="connectors-button"
          >
            <Plug size={16} />
            <span className="hidden sm:inline">الموصّلات</span>
            {props.connectorsCount ? <span className="rounded-full bg-emerald-500/20 px-1.5 text-[11px] font-semibold text-emerald-300">{props.connectorsCount}</span> : null}
          </button>
        )}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {props.agent && props.setAgent && <Chip icon={Bot} label="وكيل" cls="bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30" onOff={() => props.setAgent!(false)} />}
          {props.imageMode && props.onToggleImage && <Chip icon={ImageIcon} label="صورة" cls="bg-fuchsia-500/15 text-fuchsia-300" onOff={props.onToggleImage} />}
          {props.think && props.thinkAvailable && <Chip icon={Lightbulb} label="تفكير" cls="bg-brand-500/15 text-brand-400" onOff={() => props.setThink(false)} />}
          {props.search && props.searchAvailable && <Chip icon={Globe} label="بحث" cls="bg-brand-500/15 text-brand-400" onOff={() => props.setSearch(false)} />}
        </div>
        <div className="flex-1" />
        {props.modes?.length && props.onPickMode ? <ModeMenu modes={props.modes} active={props.activeMode ?? null} onPick={props.onPickMode} disabled={props.streaming} /> : null}
        {props.streaming ? (
          <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-ink-950 hover:bg-slate-200" onClick={props.onStop} aria-label="إيقاف التوليد" data-testid="stop-button">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-ink-600 disabled:text-slate-400"
            onClick={submit}
            disabled={(!text.trim() && !atts.length) || uploading > 0 || props.disabled}
            aria-label="إرسال الرسالة"
            data-testid="send-button"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon: I, label, hint, active, onClick, testid }: { icon: LucideIcon; label: string; hint?: string; active?: boolean; onClick: () => void; testid?: string }) {
  return (
    <button role="menuitem" className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm hover:bg-ink-700" onClick={onClick} data-testid={testid}>
      <I size={17} className={active ? "text-sky-300" : "text-slate-300"} />
      <span className="flex-1">
        {label}
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
      {active && <Check size={15} className="text-sky-300" />}
    </button>
  );
}

function Chip({ icon: I, label, cls, onOff }: { icon: LucideIcon; label: string; cls: string; onOff: () => void }) {
  return (
    <button className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium ${cls}`} onClick={onOff} title={`إيقاف ${label}`}>
      <I size={14} /> {label} <X size={12} className="opacity-70" />
    </button>
  );
}
