import "server-only";
import { prisma } from "./db";

type Ev = Record<string, unknown>;
type Listener = (rows: { seq: number; data: Ev }[]) => void;

/** How long a "streaming" message may go without any event before it is considered dead (function killed). */
export const STALE_MS = 90_000;
const FLUSH_MS = 300;
const HEARTBEAT_MS = 5_000;

/**
 * A chat/agent run that lives on the server, independent of the HTTP connection that started it.
 * Every event is coalesced (text deltas merged), numbered and written to ChatEvent; live listeners get the
 * same rows, and a client that lost its connection resumes with GET /api/chat/stream/<messageId>?after=<seq>.
 */
export class ChatJob {
  messageId: string | null = null;
  readonly controller = new AbortController();
  private seq = 0;
  private pending: Ev[] = [];
  private listeners = new Set<Listener>();
  private flushing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private lastEventAt = Date.now();
  private startedAt = Date.now();
  phase: string | null = null;
  finished = false;

  constructor() {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    // heartbeat: keeps the connection and the UI alive, records liveness, and polls for a stop request
    this.beat = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  emit = (ev: Ev) => {
    if (ev.type === "meta" && typeof ev.assistantMessageId === "string") this.messageId = ev.assistantMessageId;
    if (ev.type === "agent_status" && typeof ev.phase === "string") this.phase = ev.phase;
    this.pending.push(ev);
    this.lastEventAt = Date.now();
  };

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private async heartbeat() {
    if (this.finished || !this.messageId) return;
    if (Date.now() - this.lastEventAt >= HEARTBEAT_MS - 200) this.emit({ type: "ping", elapsedMs: Date.now() - this.startedAt, phase: this.phase });
    const m = await prisma.message.findUnique({ where: { id: this.messageId }, select: { stopRequested: true } }).catch(() => null);
    if (m?.stopRequested && !this.controller.signal.aborted) this.controller.abort();
  }

  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!this.messageId || !this.pending.length) return;
      const batch = this.pending;
      this.pending = [];
      const merged: Ev[] = [];
      for (const ev of batch) {
        const prev = merged[merged.length - 1];
        if (prev && (ev.type === "delta" || ev.type === "reasoning") && prev.type === ev.type) prev.text = String(prev.text ?? "") + String(ev.text ?? "");
        else if (prev && ev.type === "ping" && prev.type === "ping") Object.assign(prev, ev);
        else merged.push({ ...ev });
      }
      const rows = merged.map((data) => ({ seq: ++this.seq, data }));
      for (const l of this.listeners) {
        try {
          l(rows);
        } catch {}
      }
      await prisma.chatEvent
        .createMany({ data: rows.map((r) => ({ messageId: this.messageId!, seq: r.seq, data: r.data as any })) })
        .catch((e) => console.error("[chat-job] event write failed", (e as Error).message));
    });
    return this.flushing;
  }

  async finish() {
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    if (this.beat) clearInterval(this.beat);
    await this.flush();
    for (const l of this.listeners) {
      try {
        l([]);
      } catch {}
    }
    this.listeners.clear();
    // housekeeping: events are only needed while a client might reconnect
    await prisma.chatEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * 864e5) } } }).catch(() => {});
  }
}
