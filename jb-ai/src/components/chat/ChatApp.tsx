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
import { ModelPicker } from "./ModelPicker";
import { ConnectorsSheet } from "./ConnectorsSheet";
import { SpendMeter } from "./SpendMeter";
import { type ModeKey, type ModeOption } from "./ModeMenu";
import { useMentionCatalog, type MentionItem } from "./Mentions";
import { Sidebar, type ConvItem, type MeInfo } from "./Sidebar";
import { TrialBar, TrialUpgradeCard } from "./TrialUpgrade";

const MODEL_KEY = "jb.selectedModel";

const AGENT_CHAIN = ["DeepSeek V4.1 Flash", "GLM 5.3 Flash", "Kimi K3 Fast", "Qwen 3.8 Flash"];

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
  const [agent, setAgent] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("jb.sidebarCollapsed") === "1");
    } catch {}
  }, []);
  const setCollapsedSaved = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem("jb.sidebarCollapsed", v ? "1" : "0");
    } catch {}
  };
  const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [connectorsCount, setConnectorsCount] = useState(0);
  const [spendKey, setSpendKey] = useState(0);
  const [trialBlock, setTrialBlock] = useState<"exhausted" | "cap" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<{ id: string; finished: boolean; seq: number } | null>(null);
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
  const isTrial = Boolean(me?.trial);
  const agentAvailable = signedIn && !isTrial && !current?.capabilities.imageGeneration;
  const isAdmin = Boolean(me?.user?.isAdmin);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get("connected");
    if (c) {
      toast(`تم ربط ${c} ✓ — شغّل «وضع الوكيل» واستخدمه`, "ok");
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const agentOn = agent && agentAvailable;
  const mentionCatalog = useMentionCatalog(isAdmin);

  // ---- conversation loading
  const openConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setActiveId(id);
      setSidebarOpen(false);
      setLoadingConv(true);
      window.history.replaceState(null, "", `/c/${id}`);
      try {
        const d = await api<{ conversation: { id: string; modelId: string | null; agentMode?: boolean }; messages: (UiMessage & { attachments: UiMessage["attachments"] })[] }>(`/api/conversations/${id}`);
        setMessages(d.messages.map((m) => ({ ...m, status: m.status as UiMessage["status"] })));
        setAgent(Boolean(d.conversation.agentMode));
        stickToBottom.current = true;
        const live = d.messages.find((m) => m.role === "assistant" && m.status === "streaming");
        if (live) void resumeRef.current?.(live.id);
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
    setAgent(false);
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

  /** Applies one server event to the assistant message (live stream and resume stream share this). */
  function applyEvent(ref: { id: string; finished: boolean; seq: number }, ev: any) {
    if (typeof ev.seq === "number") ref.seq = Math.max(ref.seq, ev.seq);
    const now = Date.now();
    const touch = (m: UiMessage, extra: Partial<NonNullable<UiMessage["live"]>> = {}): UiMessage => ({
      ...m,
      live: { startedAt: m.live?.startedAt ?? now, ...(m.live ?? {}), lastEventAt: now, reconnecting: false, ...extra },
    });
    if (ev.type === "meta") {
      const oldId = ref.id;
      ref.id = ev.assistantMessageId;
      setMessages((list) =>
        list.map((m) => {
          if (m.id === oldId) return touch({ ...m, id: ev.assistantMessageId, modelName: ev.model?.name, notice: ev.notice, agent: Boolean(ev.agent) });
          if (m.id === "pending-user" && ev.userMessageId) return { ...m, id: ev.userMessageId };
          return m;
        }),
      );
      if (ev.conversationId && (!activeIdRef.current || activeIdRef.current !== ev.conversationId)) {
        activeIdRef.current = ev.conversationId;
        setActiveId(ev.conversationId);
        window.history.replaceState(null, "", `/c/${ev.conversationId}`);
        setConversations((c) => [{ id: ev.conversationId, title: ev.title, updatedAt: new Date().toISOString() }, ...c.filter((x) => x.id !== ev.conversationId)]);
      }
      return;
    }
    const id = ref.id;
    if (ev.type === "delta") patchMessage(id, (m) => touch({ ...m, content: m.content + ev.text }, m.agentSteps?.length ? { phase: "report", label: "يكتب الرد" } : {}));
    else if (ev.type === "reasoning") patchMessage(id, (m) => touch({ ...m, reasoning: (m.reasoning ?? "") + ev.text }, m.content ? {} : { label: m.live?.label ?? "يفكّر…" }));
    else if (ev.type === "agent_status") patchMessage(id, (m) => touch({ ...m, agent: true }, { phase: ev.phase, label: ev.label, detail: ev.detail ?? null }));
    else if (ev.type === "ping" || ev.type === "keepalive") patchMessage(id, (m) => (m.status === "streaming" ? touch(m) : m));
    else if (ev.type === "fallback") patchMessage(id, (m) => touch({ ...m, usedFallback: true, modelName: ev.model?.name, notice: `النموذج الأساسي مو متاح الحين — كمّل بالنموذج الاحتياطي ${ev.model?.name}` }));
    else if (ev.type === "agent_step")
      patchMessage(id, (m) => {
        const steps = [...(m.agentSteps ?? [])];
        const i = steps.findIndex((x) => x.id === ev.step.id);
        if (i >= 0) steps[i] = ev.step;
        else steps.push(ev.step);
        return touch({ ...m, agentSteps: steps, agent: true });
      });
    else if (ev.type === "image") patchMessage(id, (m) => touch({ ...m, attachments: [...(m.attachments ?? []).filter((a) => a.id !== ev.attachmentId), { id: ev.attachmentId, filename: "generated", mimeType: ev.mimeType, kind: "generated-image" }] }));
    else if (ev.type === "done") {
      ref.finished = true;
      patchMessage(id, (m) => ({ ...m, status: ev.status, modelName: ev.model?.name ?? m.modelName, costUsd: ev.costUsd ?? m.costUsd, live: null }));
      setSpendKey((k) => k + 1);
    } else if (ev.type === "final") {
      ref.finished = true;
      patchMessage(id, (m) => ({ ...m, status: ev.status, content: ev.content ?? m.content, error: ev.error ?? m.error, costUsd: ev.costUsd ?? m.costUsd, live: null }));
    } else if (ev.type === "error") {
      ref.finished = true;
      patchMessage(id, (m) => ({ ...m, status: "error", error: ev.error, live: null }));
    }
  }

  /** A per-connection abort controller linked to the run's, plus a watchdog: no bytes for 20 s → drop and reconnect. */
  function connection(parent: AbortSignal) {
    const c = new AbortController();
    const onAbort = () => c.abort();
    parent.addEventListener("abort", onAbort, { once: true });
    let t: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      clearTimeout(t);
      t = setTimeout(() => c.abort(), 20_000);
    };
    kick();
    return { signal: c.signal, kick, done: () => (clearTimeout(t), parent.removeEventListener("abort", onAbort)) };
  }

  async function readNdjson(res: Response, onEvent: (ev: any) => void, kick?: () => void) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      kick?.();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {}
      }
    }
  }

  /**
   * Follows a run that lives on the server (after a dropped connection, a locked phone or a reload): replays stored
   * events after `ref.seq` and keeps following until it finishes, reconnecting with backoff.
   */
  async function follow(ref: { id: string; finished: boolean; seq: number }, signal: AbortSignal) {
    let delay = 800;
    while (!ref.finished && !signal.aborted) {
      const conn = connection(signal);
      try {
        const res = await fetch(`/api/chat/stream/${ref.id}?after=${ref.seq}`, { signal: conn.signal, cache: "no-store" });
        if (res.status === 404 || res.status === 401) {
          if (res.status === 401) router.push("/login");
          patchMessage(ref.id, (m) => ({ ...m, status: m.status === "streaming" ? "error" : m.status, error: "تعذّر متابعة الرد.", live: null }));
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        delay = 800;
        await readNdjson(res, (ev) => applyEvent(ref, ev), conn.kick);
      } catch (e) {
        if (signal.aborted) return;
        patchMessage(ref.id, (m) => (m.status === "streaming" ? { ...m, live: { ...(m.live ?? { startedAt: Date.now(), lastEventAt: Date.now() }), reconnecting: true } } : m));
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 8000);
        if (typeof navigator !== "undefined" && !navigator.onLine) await new Promise((r) => window.addEventListener("online", r, { once: true }));
      } finally {
        conn.done();
      }
    }
  }

  async function runChat(body: Record<string, unknown>, assistantTempId: string) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    stickToBottom.current = true;
    const ref = { id: assistantTempId, finished: false, seq: 0 };
    runRef.current = ref;
    patchMessage(assistantTempId, (m) => ({ ...m, agent: Boolean(body.agent), live: { startedAt: Date.now(), lastEventAt: Date.now(), label: body.agent ? "يبدأ…" : body.webSearch ? "يبحث ويكتب الرد…" : "يكتب الرد…" } }));
    try {
      let res: Response;
      const conn = connection(ctrl.signal);
      try {
        res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: conn.signal });
      } catch (e) {
        conn.done();
        if (ctrl.signal.aborted) throw e;
        patchMessage(ref.id, (m) => ({ ...m, status: "error", error: "ما قدرت أوصل للخادم — تأكد من الإنترنت وجرّب مرة ثانية.", live: null }));
        return;
      }
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: `تعذّر الطلب (${res.status})` }));
        if (d.code === "model_unavailable") setSelectedModel(null);
        if (d.code === "trial_exhausted" || d.code === "trial_daily_cap") {
          // the upgrade card takes over: drop the unanswered turn
          setTrialBlock(d.code === "trial_daily_cap" ? "cap" : "exhausted");
          setMessages((list) => list.filter((m) => m.id !== ref.id && m.id !== "pending-user"));
          void loadMe();
          return;
        }
        patchMessage(ref.id, (m) => ({ ...m, status: "error", error: d.error, live: null }));
        if (res.status === 401) router.push("/login");
        return;
      }
      try {
        await readNdjson(res, (ev) => applyEvent(ref, ev), conn.kick);
      } catch (e) {
        if (ctrl.signal.aborted) throw e; // user navigated away / stopped; a watchdog abort just reconnects below
      } finally {
        conn.done();
      }
      // the connection dropped before the end (phone locked, network switch…): the run continues on the server
      if (!ref.finished && !ref.id.startsWith("pending")) await follow(ref, ctrl.signal);
      else if (!ref.finished) patchMessage(ref.id, (m) => ({ ...m, status: "error", error: "انقطع الاتصال قبل ما يبدأ الرد. جرّب مرة ثانية.", live: null }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") patchMessage(ref.id, (m) => ({ ...m, status: "error", error: "انقطع الاتصال أثناء استلام الرد.", live: null }));
    } finally {
      if (runRef.current === ref) runRef.current = null;
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

  /** Re-attaches to a run that is still going on the server (opened conversation / page reload). */
  async function resume(messageId: string) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    const ref = { id: messageId, finished: false, seq: 0 };
    runRef.current = ref;
    patchMessage(messageId, (m) => ({ ...m, content: "", reasoning: "", agentSteps: [], attachments: [], live: { startedAt: Date.now(), lastEventAt: Date.now(), label: "يتابع الشغل…" } }));
    try {
      await follow(ref, ctrl.signal);
    } finally {
      if (runRef.current === ref) runRef.current = null;
      setStreaming(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  async function stopRun() {
    const ref = runRef.current;
    if (ref && !ref.id.startsWith("pending")) {
      await fetch("/api/chat/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: ref.id }) }).catch(() => {});
      patchMessage(ref.id, (m) => (m.live ? { ...m, live: { ...m.live, label: "يوقف…" } } : m));
    } else abortRef.current?.abort();
  }

  const resumeRef = useRef<((id: string) => Promise<void>) | null>(null);
  resumeRef.current = resume;
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  function requireAuth() {
    router.push("/register");
  }

  async function send(text: string, atts: PendingAttachment[], opts?: { mentions: MentionItem[] }) {
    if (!signedIn) return requireAuth();
    // an @mention means "use this tool / deploy here": run as the agent, on the tested agent model if needed
    let modelId = selectedModel;
    let useAgent = agentOn;
    if (opts?.mentions.length && agentAvailable && !agentOn) {
      useAgent = true;
      setAgent(true);
      const agentModel = config?.defaults.agent;
      if (agentModel && !AGENT_CHAIN.includes(current?.name ?? "")) {
        modelId = agentModel;
        setSelectedModel(agentModel);
      }
    }
    if (me?.user?.mustVerify) return toast(isTrial ? "أكّد إيميلك أول، بعدها تقدر ترسل." : "يرجى تأكيد بريدك الإلكتروني أولًا.", "err");
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [
      ...list,
      { id: "pending-user", role: "user", content: text, status: "complete", attachments: atts.map((a) => ({ ...a })) },
      { id: tempId, role: "assistant", content: "", status: "streaming" },
    ]);
    await runChat({ conversationId: activeIdRef.current, content: text, attachmentIds: atts.map((a) => a.id), modelId, think, webSearch: search && searchAvailable && !searchLocked, agent: useAgent }, tempId);
  }

  async function regenerate() {
    if (streaming || !activeId) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [...list.slice(0, lastUserIdx + 1), { id: tempId, role: "assistant", content: "", status: "streaming" }]);
    await runChat({ conversationId: activeId, regenerate: true, modelId: selectedModel, think, webSearch: search && searchAvailable && !searchLocked, agent: agentOn }, tempId);
  }

  async function editMessage(id: string, content: string) {
    if (streaming || !activeId) return;
    const idx = messages.findIndex((m) => m.id === id);
    const tempId = `pending-assistant-${Date.now()}`;
    setMessages((list) => [...list.slice(0, idx), { ...list[idx]!, content }, { id: tempId, role: "assistant", content: "", status: "streaming" }]);
    await runChat({ conversationId: activeId, editMessageId: id, content, modelId: selectedModel, think, webSearch: search && searchAvailable && !searchLocked, agent: agentOn }, tempId);
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

  async function removeAll() {
    try {
      const d = await api<{ deleted: number }>("/api/conversations", { method: "DELETE" });
      abortRef.current?.abort();
      setConversations([]);
      newChat();
      toast(`انحذفت ${d.deleted} محادثة.`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  const lastTextModel = useRef<string | null>(null);
  const imageDefault = config?.defaults.image ?? models.find((m) => m.capabilities.imageGeneration)?.id ?? null;
  function toggleImageMode() {
    if (current?.capabilities.imageGeneration) {
      chooseModel(lastTextModel.current && models.some((m) => m.id === lastTextModel.current) ? lastTextModel.current : (defaultId ?? ""));
    } else if (imageDefault) {
      lastTextModel.current = current?.id ?? null;
      chooseModel(imageDefault);
    }
  }

  // role picker: each role → the default model the admin set for it (Admin → الافتراضيات)
  const trial = me?.trial ?? null;
  const trialOut: "exhausted" | "cap" | null = trial ? (trialBlock ?? (trial.remaining <= 0 ? "exhausted" : trial.capReached ? "cap" : null)) : null;
  const modeOptions: ModeOption[] = trial ? [] : (["text", "reasoning", "code", "vision", "image"] as ModeKey[])
    .map((key) => {
      const id = key === "image" ? imageDefault : (config?.defaults[key] ?? null);
      const m = id ? models.find((x) => x.id === id) : undefined;
      return m ? { key, modelId: m.id, modelName: m.name } : null;
    })
    .filter((x): x is ModeOption => Boolean(x));
  const activeMode: ModeKey | null = current?.capabilities.imageGeneration
    ? "image"
    : think && modeOptions.some((o) => o.key === "reasoning" && o.modelId === current?.id)
      ? "reasoning"
      : (modeOptions.find((o) => o.modelId === current?.id && o.key !== "image" && (o.key !== "reasoning" || think))?.key ?? (current ? null : "text"));
  function pickMode(o: ModeOption) {
    if (o.key === "image") {
      if (!current?.capabilities.imageGeneration) lastTextModel.current = current?.id ?? null;
    } else if (o.key === "reasoning") setThink(true);
    else setThink(false);
    if (o.key !== "text" && o.key !== "image" && agentOn && o.key !== "code") setAgent(false);
    chooseModel(o.modelId);
  }

  function chooseModel(id: string) {
    setSelectedModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {}
  }

  const empty = !messages.length && !loadingConv;
  const siteName = config?.site.name ?? "محمد | التقني";
  const lastAssistantIdx = useMemo(() => messages.map((m) => m.role).lastIndexOf("assistant"), [messages]);

  const composer = (
    <Composer
      onSend={send}
      mentionItems={isAdmin && agentAvailable ? mentionCatalog.items : undefined}
      modes={signedIn ? modeOptions : undefined}
      activeMode={activeMode}
      onPickMode={pickMode}
      onMentionOpen={() => void mentionCatalog.reload()}
      onStop={() => void stopRun()}
      streaming={streaming}
      think={think}
      setThink={setThink}
      thinkAvailable={!isTrial && reasoningAvailable && !current?.capabilities.imageGeneration}
      search={search}
      setSearch={setSearch}
      searchAvailable={!isTrial && searchAvailable}
      searchLocked={searchLocked}
      uploadsAllowed={me?.plan?.allowUploads ?? false}
      onRequireAuth={signedIn ? undefined : requireAuth}
      placeholder={current?.capabilities.imageGeneration ? `صِف الصورة التي تريد إنشاءها (${current.name})` : agentOn ? "وش المهمة؟ اكتب @ لتختار أداة أو مكان النشر" : isAdmin ? "اسأل أي شيء — اكتب @ لأداة أو مكان نشر" : "اسأل أي شيء"}
      imageMode={Boolean(current?.capabilities.imageGeneration)}
      agent={agentOn}
      setAgent={
        agentAvailable
          ? (v: boolean) => {
              setAgent(v);
              // switch to the tested agent model when turning agent mode on (the user can still pick another)
              const agentModel = config?.defaults.agent;
              if (v && agentModel && selectedModel !== agentModel && !AGENT_CHAIN.includes(current?.name ?? "")) {
                setSelectedModel(agentModel);
                toast("وضع الوكيل يشتغل أفضل مع DeepSeek V4.1 Flash — اخترته لك.", "info");
              }
            }
          : undefined
      }
      onToggleImage={signedIn && !isTrial && (imageDefault || current?.capabilities.imageGeneration) ? toggleImageMode : undefined}
      onOpenConnectors={isAdmin ? () => setConnectorsOpen(true) : undefined}
      connectorsCount={connectorsCount}
      autoFocus
      disabled={config?.site.maintenanceMode}
    />
  );
  const composerArea = (
    <>
      {trial && trialOut ? (
        <TrialUpgradeCard t={trial} reason={trialOut} />
      ) : (
        <>
          {trial && <TrialBar t={trial} />}
          {composer}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] overflow-hidden">
      <Sidebar
        siteName={siteName}
        me={me}
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
        onNew={newChat}
        onRename={rename}
        onDelete={remove}
        onDeleteAll={removeAll}
        collapsed={collapsed}
        onCollapse={() => (isDesktop() ? setCollapsedSaved(true) : setSidebarOpen(false))}
        onSearch={(q) => signedIn && loadConversations(q)}
        onLogout={logout}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="relative isolate flex min-w-0 flex-1 flex-col">
        <div aria-hidden className="chat-bg" data-testid="chat-bg" />
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
          <button
            className={`btn-ghost p-2 ${collapsed ? "" : "md:hidden"}`}
            onClick={() => (isDesktop() ? setCollapsedSaved(false) : setSidebarOpen(true))}
            aria-label="إظهار المحادثات"
            title="إظهار المحادثات"
            data-testid="sidebar-open"
          >
            <Menu size={20} />
          </button>
          <ModelPicker models={models} value={selectedModel} onChange={chooseModel} defaultId={defaultId} signedIn={signedIn} title={config?.trialListTitle ?? null} />
          <span className="hidden items-center gap-1 text-[11px] text-slate-500 sm:flex" title={connected ? "متصل بالتحديثات المباشرة" : "جارٍ إعادة الاتصال بالتحديثات المباشرة"}>
            {connected ? <Wifi size={12} className="text-emerald-400" /> : <WifiOff size={12} />}
          </span>
          <div className="flex-1" />
          {isAdmin && <SpendMeter refreshKey={spendKey} />}
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
            <MailWarning size={16} className="shrink-0" /> {isTrial ? "أكّد إيميلك عشان تبدأ، شيّك على بريدك (وحتى الـ Spam)." : "أكّد بريدك الإلكتروني لتبدأ المحادثة. تحقّق من صندوق الوارد."}
            <button className="ms-auto underline" onClick={() => api("/api/auth/resend", { method: "POST" }).then(() => toast(isTrial ? "أرسلنا لك رابط التأكيد مرة ثانية" : "تم إرسال رسالة التأكيد", "ok")).catch((e) => toast(e.message, "err"))}>
              {isTrial ? "أرسله مرة ثانية" : "إعادة الإرسال"}
            </button>
          </div>
        )}
        {config?.site.maintenanceMode && <div className="mx-auto mb-1 w-full max-w-3xl rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">الخدمة تحت الصيانة حاليًا. المحادثة غير متاحة مؤقتًا.</div>}

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-3 pb-24 sm:px-4">
            <h1 className="text-center text-4xl font-medium sm:text-5xl">اسأل أي شيء</h1>
            <p className="mt-3 text-center text-[15px] text-slate-300 sm:text-base">{config?.site.tagline ?? "مساعدة في البرمجة، وأسئلة تقنية، وأكثر."}</p>
            <div className="mt-8 w-full max-w-3xl">{composerArea}</div>
            {config && !models.length && <p className="mt-4 text-sm text-slate-500">لا توجد نماذج مفعّلة بعد. على المسؤول تفعيل النماذج من مركز إدارة المحركات.</p>}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
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
              {composerArea}
              <p className="mt-2 text-center text-[11px] text-slate-500">قد يخطئ الذكاء الاصطناعي. تحقّق من المعلومات المهمة.</p>
            </div>
          </>
        )}
      </main>
      {isAdmin && <ConnectorsSheet open={connectorsOpen} onClose={() => setConnectorsOpen(false)} onCount={setConnectorsCount} />}
    </div>
  );
}
