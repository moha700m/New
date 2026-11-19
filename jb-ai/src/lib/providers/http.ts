import { ProviderError, type ProviderRuntimeConfig } from "./types";

export function authHeaders(cfg: ProviderRuntimeConfig): Record<string, string> {
  const h: Record<string, string> = { ...cfg.extraHeaders };
  if (cfg.apiKey) {
    h[cfg.authHeader || "Authorization"] = cfg.authScheme ? `${cfg.authScheme} ${cfg.apiKey}` : cfg.apiKey;
  }
  return h;
}

export function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

/** Combine a caller abort signal with a timeout. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

function summarize(text: string) {
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail;
    if (typeof m === "string") return m.slice(0, 400);
    if (m) return JSON.stringify(m).slice(0, 400);
  } catch {}
  return text.slice(0, 400) || "empty response";
}

const idleBumpers = new WeakMap<Response, () => void>();

/**
 * fetch with a timeout for the *response headers* and then an *idle* timeout while the body streams
 * (reset on every chunk). A single total timeout used to cut long answers / web-search streams mid-way
 * ("The operation was aborted due to timeout").
 */
export async function providerFetch(cfg: ProviderRuntimeConfig, url: string, init: RequestInit & { signal?: AbortSignal; timeoutMs?: number }) {
  const limit = init.timeoutMs ?? cfg.timeoutMs;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(init.signal?.reason);
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort(init.signal.reason);
    else init.signal.addEventListener("abort", onAbort, { once: true });
  }
  let timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), limit);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
    const err = e as Error;
    if (init.signal?.aborted) throw err; // caller cancelled: propagate as abort
    const timeout = err.name === "TimeoutError" || err.name === "AbortError";
    throw new ProviderError(timeout ? `${cfg.name}: request timed out` : `${cfg.name}: network error (${err.message})`, 0, true, true);
  }
  clearTimeout(timer);
  const idleMs = Math.max(limit, 90_000);
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(new DOMException("idle timeout", "TimeoutError")), idleMs);
  };
  bump();
  idleBumpers.set(res, bump);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    clearTimeout(timer);
    const msg = `${cfg.name} ${res.status}: ${summarize(body)}`;
    const s = res.status;
    const retryable = s === 429 || s >= 500;
    const fallbackable = retryable || s === 401 || s === 402 || s === 403 || s === 404 || s === 408;
    throw new ProviderError(msg, s, fallbackable, retryable);
  }
  return res;
}

/** Parse a text/event-stream body into `data:` payloads. */
export async function* sseData(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      idleBumpers.get(res)?.();
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          event = undefined;
          continue;
        }
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) yield { event, data: line.slice(5).trimStart() };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Splits `<think>...</think>` segments embedded in content into reasoning chunks. */
export class ThinkTagSplitter {
  private inThink = false;
  private pending = "";
  push(text: string): { type: "text" | "reasoning"; text: string }[] {
    const out: { type: "text" | "reasoning"; text: string }[] = [];
    let s = this.pending + text;
    this.pending = "";
    while (s.length) {
      const tag = this.inThink ? "</think>" : "<think>";
      const i = s.indexOf(tag);
      if (i >= 0) {
        if (i > 0) out.push({ type: this.inThink ? "reasoning" : "text", text: s.slice(0, i) });
        s = s.slice(i + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // keep a possible partial tag at the end
      let keep = 0;
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
        if (tag.startsWith(s.slice(-k))) {
          keep = k;
          break;
        }
      }
      const emit = s.slice(0, s.length - keep);
      if (emit) out.push({ type: this.inThink ? "reasoning" : "text", text: emit });
      this.pending = s.slice(s.length - keep);
      s = "";
    }
    return out;
  }
  flush() {
    const p = this.pending;
    this.pending = "";
    return p ? [{ type: (this.inThink ? "reasoning" : "text") as "text" | "reasoning", text: p }] : [];
  }
}
