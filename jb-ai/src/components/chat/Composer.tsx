"use client";
import { ArrowUp, FileText, Globe, Lightbulb, Loader2, Plus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "../ui/Toast";

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  kind: string;
  previewUrl?: string;
}

export function Composer(props: {
  onSend: (text: string, attachments: PendingAttachment[]) => void;
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
}) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<PendingAttachment[]>([]);
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
    if (!props.uploadsAllowed) return toast("File uploads are not included in your plan.", "err");
    for (const file of Array.from(files).slice(0, 8)) {
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
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
    props.onSend(text.trim(), atts);
    setText("");
    setAtts([]);
  }

  return (
    <div
      className="rounded-2xl border border-ink-500/70 bg-ink-850/90 shadow-[0_0_0_1px_rgba(91,140,255,0.06),0_10px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur focus-within:border-brand-500/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {atts.map((a) => (
            <div key={a.id} className="group relative flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 py-1 pl-1 pr-2 text-xs">
              {a.previewUrl ? <img src={a.previewUrl} alt="" className="h-9 w-9 rounded object-cover" /> : <FileText size={18} className="ml-1 text-slate-400" />}
              <span className="max-w-[140px] truncate">{a.filename}</span>
              <button className="text-slate-400 hover:text-white" onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))} aria-label={`Remove ${a.filename}`}>
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
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void upload(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={props.placeholder ?? "Ask anything"}
        className="block max-h-60 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] text-slate-100 outline-none placeholder:text-slate-500"
        data-testid="composer-input"
      />
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ""))} />
        <button className="btn-ghost h-9 w-9 p-0" onClick={() => (props.onRequireAuth ? props.onRequireAuth() : fileRef.current?.click())} aria-label="Attach files" title="Attach images or text files">
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={19} />}
        </button>
        {props.thinkAvailable && (
          <button
            className={`btn h-9 px-2.5 ${props.think ? "bg-brand-500/20 text-brand-400" : "text-slate-300 hover:bg-ink-700"}`}
            onClick={() => props.setThink(!props.think)}
            aria-pressed={props.think}
            title="Think: use a reasoning model for harder problems"
          >
            <Lightbulb size={16} /> <span className="hidden sm:inline">Think</span>
          </button>
        )}
        {props.searchAvailable && (
          <button
            className={`btn h-9 px-2.5 ${props.search ? "bg-brand-500/20 text-brand-400" : "text-slate-300 hover:bg-ink-700"}`}
            onClick={() => (props.searchLocked ? toast("Web search is available on paid plans.", "info") : props.setSearch(!props.search))}
            aria-pressed={props.search}
            title={props.searchLocked ? "Upgrade to use web search" : "Search the web"}
          >
            <Globe size={16} /> <span className="hidden sm:inline">Search</span>
          </button>
        )}
        <div className="flex-1" />
        {props.streaming ? (
          <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-ink-950 hover:bg-slate-200" onClick={props.onStop} aria-label="Stop generating" data-testid="stop-button">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-ink-600 disabled:text-slate-400"
            onClick={submit}
            disabled={(!text.trim() && !atts.length) || uploading > 0 || props.disabled}
            aria-label="Send message"
            data-testid="send-button"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
