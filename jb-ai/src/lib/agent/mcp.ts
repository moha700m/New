import "server-only";

/**
 * Minimal MCP client for remote servers.
 * Supports the Streamable HTTP transport (spec 2025-03-26 / 2025-06-18) and the legacy HTTP+SSE transport (2024-11-05).
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
export interface McpCallResult {
  text: string;
  images: { mimeType: string; base64: string }[];
  isError: boolean;
}
export interface McpConnectOptions {
  url: string;
  transport?: string; // auto | streamable | sse
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const PROTOCOL = "2025-06-18";
const CLIENT_INFO = { name: "jb-ai-agent", version: "1.0.0" };

type Json = Record<string, any>;

function sig(signal: AbortSignal | undefined, ms: number) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** Parses an SSE byte stream into {event,data} records. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (data.length) yield { event, data: data.join("\n") };
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function errText(e: Json) {
  return typeof e?.message === "string" ? e.message : JSON.stringify(e).slice(0, 300);
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private mode: "streamable" | "sse" | null = null;
  private protocol = PROTOCOL;
  // legacy SSE state
  private postUrl: string | null = null;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private sseAbort: AbortController | null = null;
  public serverInfo: Json | null = null;

  constructor(private opts: McpConnectOptions) {}

  private get timeout() {
    return this.opts.timeoutMs ?? 60_000;
  }

  private baseHeaders(): Record<string, string> {
    return {
      ...(this.opts.headers ?? {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...(this.mode === "streamable" && this.serverInfo ? { "MCP-Protocol-Version": this.protocol } : {}),
    };
  }

  async connect(): Promise<void> {
    const t = (this.opts.transport || "auto").toLowerCase();
    if (t === "sse") return this.connectSse();
    try {
      this.mode = "streamable";
      await this.initialize();
    } catch (e) {
      if (t === "streamable" || this.opts.signal?.aborted) throw e;
      this.mode = null;
      this.sessionId = null;
      try {
        await this.connectSse();
      } catch (e2) {
        throw new Error(`MCP connect failed (streamable: ${(e as Error).message}; sse: ${(e2 as Error).message})`);
      }
    }
  }

  private async initialize() {
    const res = await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO });
    this.serverInfo = res.serverInfo ?? {};
    if (typeof res.protocolVersion === "string") this.protocol = res.protocolVersion;
    await this.notify("notifications/initialized");
  }

  // ---------------------------------------------------------------- streamable HTTP
  private async postStreamable(msg: Json): Promise<Json | null> {
    const res = await fetch(this.opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...this.baseHeaders() },
      body: JSON.stringify(msg),
      signal: sig(this.opts.signal, this.timeout),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
    if (msg.id === undefined) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream") && res.body) {
      for await (const ev of sseEvents(res.body)) {
        let m: any;
        try {
          m = JSON.parse(ev.data);
        } catch {
          continue;
        }
        const arr = Array.isArray(m) ? m : [m];
        const hit = arr.find((x) => x && x.id === msg.id && ("result" in x || "error" in x));
        if (hit) {
          void res.body.cancel().catch(() => {});
          return hit;
        }
      }
      throw new Error("stream ended without a response");
    }
    const text = await res.text();
    let m: any;
    try {
      m = JSON.parse(text);
    } catch {
      throw new Error(`invalid JSON response: ${text.slice(0, 200)}`);
    }
    const arr = Array.isArray(m) ? m : [m];
    return arr.find((x) => x && x.id === msg.id) ?? arr[0];
  }

  // ---------------------------------------------------------------- legacy SSE
  private async connectSse() {
    this.mode = "sse";
    this.sseAbort = new AbortController();
    const signal = this.opts.signal ? AbortSignal.any([this.opts.signal, this.sseAbort.signal]) : this.sseAbort.signal;
    const res = await fetch(this.opts.url, { headers: { Accept: "text/event-stream", ...(this.opts.headers ?? {}) }, signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) throw new Error("not an SSE endpoint");
    const events = sseEvents(res.body);
    const endpoint = await Promise.race([
      (async () => {
        for await (const ev of events) {
          if (ev.event === "endpoint") return ev.data.trim();
        }
        throw new Error("SSE closed before endpoint event");
      })(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("no endpoint event within 15s")), 15_000)),
    ]);
    this.postUrl = new URL(endpoint, this.opts.url).toString();
    // background pump
    void (async () => {
      try {
        for await (const ev of events) {
          if (ev.event !== "message") continue;
          let m: any;
          try {
            m = JSON.parse(ev.data);
          } catch {
            continue;
          }
          for (const x of Array.isArray(m) ? m : [m]) {
            const p = typeof x?.id === "number" ? this.pending.get(x.id) : undefined;
            if (p && ("result" in x || "error" in x)) {
              this.pending.delete(x.id);
              p.resolve(x);
            }
          }
        }
      } catch {}
      for (const p of this.pending.values()) p.reject(new Error("SSE connection closed"));
      this.pending.clear();
    })();
    await this.initialize();
  }

  private async postSse(msg: Json): Promise<Json | null> {
    const wait =
      msg.id !== undefined
        ? new Promise<Json>((resolve, reject) => {
            this.pending.set(msg.id, { resolve, reject });
            setTimeout(() => {
              if (this.pending.delete(msg.id)) reject(new Error("MCP request timed out"));
            }, this.timeout);
          })
        : null;
    const res = await fetch(this.postUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.opts.headers ?? {}) },
      body: JSON.stringify(msg),
      signal: sig(this.opts.signal, this.timeout),
    });
    if (!res.ok) {
      if (msg.id !== undefined) this.pending.delete(msg.id);
      throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    await res.body?.cancel().catch(() => {});
    return wait ? await wait : null;
  }

  // ---------------------------------------------------------------- JSON-RPC
  private async request(method: string, params?: Json): Promise<Json> {
    const msg = { jsonrpc: "2.0", id: this.nextId++, method, ...(params ? { params } : {}) };
    const r = this.mode === "sse" ? await this.postSse(msg) : await this.postStreamable(msg);
    if (!r) throw new Error("empty response");
    if (r.error) throw new Error(`MCP error: ${errText(r.error)}`);
    return r.result ?? {};
  }

  private async notify(method: string, params?: Json) {
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    try {
      if (this.mode === "sse") await this.postSse(msg);
      else await this.postStreamable(msg);
    } catch {
      /* notifications are best-effort */
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const out: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : undefined);
      for (const t of r.tools ?? []) if (t?.name) out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  async callTool(name: string, args: Json): Promise<McpCallResult> {
    const r = await this.request("tools/call", { name, arguments: args ?? {} });
    const parts: string[] = [];
    const images: McpCallResult["images"] = [];
    for (const c of r.content ?? []) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "image" && c.data) images.push({ mimeType: c.mimeType || "image/png", base64: c.data });
      else if (c.type === "resource" && c.resource) parts.push(c.resource.text ?? `[resource ${c.resource.uri}]`);
      else if (c.type === "resource_link") parts.push(`[${c.name ?? "link"}](${c.uri})`);
      else parts.push(JSON.stringify(c).slice(0, 2000));
    }
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
    return { text: parts.join("\n\n"), images, isError: Boolean(r.isError) };
  }

  async close() {
    try {
      if (this.mode === "streamable" && this.sessionId) {
        await fetch(this.opts.url, { method: "DELETE", headers: this.baseHeaders(), signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
    } finally {
      this.sseAbort?.abort();
    }
  }
}

/** Expose only the tools matching the filter (comma list; `prefix*` allowed). Empty filter = all tools. */
export function filterTools<T extends { name: string }>(tools: T[], filter: string | null | undefined): T[] {
  const pats = (filter ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return tools;
  return tools.filter((t) => pats.some((p) => (p.endsWith("*") ? t.name.startsWith(p.slice(0, -1)) : t.name === p)));
}
