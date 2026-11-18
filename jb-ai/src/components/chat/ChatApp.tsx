"use client";
import { Menu, MailWarning, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../ui/Toast";
import { useLiveConfig } from "../useLiveConfig";
import { Composer, type PendingAttachment } from "./Composer";
import { MessageView, type UiMessage } from "./MessageView";
import { isUncensoredModel, ModelSelector } from "./ModelSelector";
import { Sidebar, type ConvItem, type MeInfo } from "./Sidebar";

const MODEL_KEY = "jb.selectedModel";

export function ChatApp({ initialConversationId }: { initialConversationId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { config, connected } = useLiveConfig();
  const [me, setMe] = useState<MeInfo | null>(null);
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [think, setThink] = useState(false);
  const [search, setSearch] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevVersion = useRef<number>(0);

  const signedIn = Boolean(me?.user);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<MeInfo>("/api/auth/me"));
    } catch {
      setMe({ user: null });
    }
  }, []);

  const loadConversations = useCallback(async (q = "") => {
    try {
      const d = await api<{ conversations: ConvItem[] }>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setConversations(d.conversations);
    } catch {}
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (signedIn) void loadConversations();
  }, [signedIn, loadConversations]);

  useEffect(() => {
    try {
      setSelectedModel(localStorage.getItem(MODEL_KEY));
    } catch {}
  }, []);

  // ---- live config: validate selected model whenever the catalog changes
  const models = config?.models ?? [];
  const defaultId = config?.defaults.text ?? null;
  useEffect(() => {
    if (!config) return;
    if (prevVersion.current && prevVersion.current !== config.version) void loadMe();
    prevVersion.current = config.version;
    if (!selectedModel) return;
    const m = config.models.find((x) => x.id === selectedModel);
    if (!m || (signedIn && !m.allowed)) {
      const fallbackName = config.models.find((x) => x.id === config.defaults.text)?.name;
      setSelectedModel(null);
      try {
        localStorage.removeItem(MODEL_KEY);
      } catch {}
      toast(`النموذج الذي اخترته لم يعد متاحًا${fallbackName ? ` — تم التحويل إلى ${fallbackName}` : ""}.`, "info");
    }
  }, [config, selectedModel, signedIn, toast, loadMe]);

  const current = models.find((m) => m.id === selectedModel) ?? models.find((m) => m.id === defaultId) ?? null;
  const reasoningAvailable = Boolean(config?.defaults.reasoning) || Boolean(current?.capabilities.reasoning);
  const searchAvailable = Boolean(current?.capabilities.webSearch);
  const searchLocked = signedIn && !me?.plan?.allowWebSearch;

  // ---- conversation loading
  const openConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setActiveId(id);
      setSidebarOpen(false);
      setLoadingConv(true);
      window.history.replaceState(null, "", `/c/${id}`);
      try {
        const d = await api<{ conversation: { id: string; modelId: string | null }; messages: (UiMessage & { attachments: UiMessage["attachments"] })[] }>(`/api/conversations/${id}`);
        setMessages(d.messages.map((m) => ({ ...m, status: m.status as UiMessage["status"] })));
        stickToBottom.current = true;
      } catch (e) {
        toast((e as Error).message, "err");
        window.history.replaceState(null, "", "/");
        setActiveId(null);
        setMessages([]);
      } finally {
        setLoadingConv(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (initialConversationId && signedIn) void openConversation(initialConversationId);
  }, [initialConversationId, signedIn, openConversation]);

  function newChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
    window.history.replaceState(null, "", "/");
  }

  // ---- autoscroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function patchMessage(id: string, fn: (m: UiMessage) => UiMessage) {
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)));
  }

  async function runChat(body: Record<string, unknown>, assistantTempId: string) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    stickToBottom.current = true;
    let assistantId = assistantTempId;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: `تعذّر الطلب (${res.status})` }));
        if (d.code === "model_unavailable") setSelectedModel(null);
        patchMessage(assistantId, (m) => ({ ...m, status: "error", error: d.error }));
        if (res.status === 401) router.push("/login");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") {
            const oldId = assistantId;
            assistantId = ev.assistantMessageId;
            setMessages((list) =>
              list.map((m) => {
                if (m.id === oldId) return { ...m, id: ev.assistantMessageId, modelName: ev.model?.name, notice: ev.notice };
                if (m.id === "pending-user" && ev.userMessageId) return { ...m, id: ev.userMessageId };
                return m;
              }),
            );
            if (!activeIdRef.current || activeIdRef.current !== ev.conversationId) {
              activeIdRef.current = ev.conversationId;
              setActiveId(ev.conversationId);
              window.history.replaceState(null, "", `/c/${ev.conversationId}`);
              setConversations((c) => [{ id: ev.conversationId, title: ev.title, updatedAt: new Date().toISOString() }, ...c.filter((x) => x.id !== ev.conversationId)]);
            }
          } else if (ev.type === "delta") {
            patchMessage(assistantId, (m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === "reasoning") {
            patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }));
          } else if (ev.type === "fallback") {
            patchMessage(assistantId, (m) => ({ ...m, usedFallback: true, modelName: ev.model?.name, notice: `النموذج الأساسي غير متاح — أجاب النموذج الاحتياطي ${ev.model?.name} (${ev.provider})` }));
          } else if (ev.type === "image") {
            patchMessage(assistantId, (m) => ({ ...m, attachments: [...(m.attachments ?? []), { id: ev.attachmentId, filename: "generated", mimeType: ev.mimeType, kind: "generated-image" }] }));
          } else if (ev.type === "done") {
            patchMessage(assistantId, (m) => ({ ...m, status: ev.status, modelName: ev.model?.name ?? m.modelName }));
          } else if (ev.type === "error") {
            patchMessage(assistantId, (m) => ({ ...m, status: "error", error: ev.error }));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") patchMessage(assistantId, (m) => ({ ...m, status: m.status === "streaming" ? "stopped" : m.status }));
      else patchMessage(assistantId, (m) => ({ ...m, status: "error", error: "انقطع الاتصال أثناء استلام الرد." }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setConversations((c) => {
        const id = activeIdRef.current;
        const item = c.find((x) => x.id === id);
        return item ? [{ ...item, updatedAt: new Date().toISOString() }, ...c.filter((x) => x.id !== id)] : c;
      });
      void loadMe();
    }
  }

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  function requireAuth() {
    router.push("/register");
  }

  async function send(text: string, atts: PendingAttachment[]) {
    if (!signedIn) return requireAuth();
    if (me?.user?.mustVerify) return toast("يرجى تأكيد بريدك الإلكتروني أولًا.", "err");
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [
      ...list,
      { id: "pending-user", role: "user", content: text, status: "complete", attachments: atts.map((a) => ({ ...a })) },
      { id: tempId, role: "assistant", content: "", status: "streaming" },
    ]);
    await runChat({ conversationId: activeIdRef.current, content: text, attachmentIds: atts.map((a) => a.id), modelId: selectedModel, think, webSearch: search && searchAvailable && !searchLocked }, tempId);
  }

  async function regenerate() {
    if (streaming || !activeId) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [...list.slice(0, lastUserIdx + 1), { id: tempId, role: "assistant", content: "", status: "streaming" }]);
    await runChat({ conversationId: activeId, regenerate: true, modelId: selectedModel, think, webSearch: search && searchAvailable && !searchLocked }, tempId);
  }

  async function editMessage(id: string, content: string) {
    if (streaming || !activeId) return;
    const idx = messages.findIndex((m) => m.id === id);
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [...list.slice(0, idx), { ...list[idx]!, content }, { id: tempId, role: "assistant", content: "", status: "streaming" }]);
    await runChat({ conversationId: activeId, editMessageId: id, content, modelId: selectedModel, think, webSearch: search && searchAvailable && !searchLocked }, tempId);
  }

  async function rename(id: string, title: string) {
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: { title } });
      setConversations((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((c) => c.filter((x) => x.id !== id));
      if (activeId === id) newChat();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  function chooseModel(id: string) {
    setSelectedModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {}
  }

  const empty = !messages.length && !loadingConv;
  const siteName = config?.site.name ?? "JB AI";
  const lastAssistantIdx = useMemo(() => messages.map((m) => m.role).lastIndexOf("assistant"), [messages]);

  const composer = (
    <Composer
      onSend={send}
      onStop={() => abortRef.current?.abort()}
      streaming={streaming}
      think={think}
      setThink={setThink}
      thinkAvailable={reasoningAvailable && !current?.capabilities.imageGeneration}
      search={search}
      setSearch={setSearch}
      searchAvailable={searchAvailable}
      searchLocked={searchLocked}
      uploadsAllowed={me?.plan?.allowUploads ?? false}
      onRequireAuth={signedIn ? undefined : requireAuth}
      placeholder={current?.capabilities.imageGeneration ? "صِف الصورة التي تريد إنشاءها" : "اسأل أي شيء"}
      autoFocus
      disabled={config?.site.maintenanceMode}
    />
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar
        siteName={siteName}
        me={me}
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
        onNew={newChat}
        onRename={rename}
        onDelete={remove}
        onSearch={(q) => signedIn && loadConversations(q)}
        onLogout={logout}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
          <button className="btn-ghost p-2 md:hidden" onClick={() => setSidebarOpen(true)} aria-label="فتح القائمة">
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5">
            <ModelSelector models={models.filter((m) => !isUncensoredModel(m))} value={selectedModel} onChange={chooseModel} defaultId={defaultId} signedIn={signedIn} />
            {models.some(isUncensoredModel) && (
              <ModelSelector variant="uncensored" models={models.filter(isUncensoredModel)} value={selectedModel} onChange={chooseModel} defaultId={defaultId} signedIn={signedIn} />
            )}
          </div>
          <span className="hidden items-center gap-1 text-[11px] text-slate-500 sm:flex" title={connected ? "متصل بالتحديثات المباشرة" : "جارٍ إعادة الاتصال بالتحديثات المباشرة"}>
            {connected ? <Wifi size={12} className="text-emerald-400" /> : <WifiOff size={12} />}
          </span>
          <div className="flex-1" />
          {!signedIn && me && (
            <div className="flex items-center gap-2">
              <Link href="/plans" className="hidden text-sm text-brand-400 hover:text-brand-400/80 sm:block">الباقات</Link>
              <Link href="/login" className="btn-outline hidden px-3 py-1.5 sm:inline-flex">تسجيل الدخول</Link>
              <Link href="/register" className="btn-primary px-3 py-1.5">سجّل مجانًا</Link>
            </div>
          )}
        </header>

        {me?.user?.mustVerify && (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-100 sm:mx-auto sm:w-full sm:max-w-3xl">
            <MailWarning size={16} className="shrink-0" /> أكّد بريدك الإلكتروني لتبدأ المحادثة. تحقّق من صندوق الوارد.
            <button className="ms-auto underline" onClick={() => api("/api/auth/resend", { method: "POST" }).then(() => toast("تم إرسال رسالة التأكيد", "ok")).catch((e) => toast(e.message, "err"))}>
              إعادة الإرسال
            </button>
          </div>
        )}
        {config?.site.maintenanceMode && <div className="mx-auto mb-1 w-full max-w-3xl rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">الخدمة تحت الصيانة حاليًا. المحادثة غير متاحة مؤقتًا.</div>}

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-3 pb-24 sm:px-4">
            <h1 className="text-center text-4xl font-medium sm:text-5xl">اسأل أي شيء</h1>
            <p className="mt-3 text-center text-[15px] text-slate-300 sm:text-base">{config?.site.tagline ?? "مساعدة في البرمجة، وأسئلة تقنية، وأكثر."}</p>
            <div className="mt-8 w-full max-w-3xl">{composer}</div>
            {config && !models.length && <p className="mt-4 text-sm text-slate-500">لا توجد نماذج مفعّلة بعد. على المسؤول تفعيل النماذج من مركز إدارة المحركات.</p>}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="mx-auto w-full max-w-3xl space-y-7 px-3 pb-8 pt-4 sm:px-4">
                {loadingConv && <p className="text-center text-sm text-slate-500">جارٍ تحميل المحادثة…</p>}
                {messages.map((m, i) => (
                  <MessageView
                    key={m.id}
                    m={m}
                    isLast={i === lastAssistantIdx && i === messages.length - 1}
                    canAct={!streaming && !m.id.startsWith("pending")}
                    onRegenerate={regenerate}
                    onEdit={(content) => editMessage(m.id, content)}
                  />
                ))}
              </div>
            </div>
            <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4">
              {composer}
              <p className="mt-2 text-center text-[11px] text-slate-500">قد يخطئ الذكاء الاصطناعي. تحقّق من المعلومات المهمة.</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
