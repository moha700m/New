"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface LiveModel {
  id: string;
  name: string;
  description: string | null;
  category: "TEXT" | "REASONING" | "CODE" | "VISION" | "IMAGE";
  provider: string;
  contextLength: number | null;
  capabilities: { vision: boolean; webSearch: boolean; reasoning: boolean; tools: boolean; imageGeneration: boolean; code: boolean; streaming: boolean; structuredOutput: boolean; uncensored?: boolean; free?: boolean };
  plans: string[];
  allowed: boolean;
}

export interface LiveConfig {
  version: number;
  site: { name: string; tagline: string; maintenanceMode: boolean; registrationOpen: boolean };
  planKey: string | null;
  live: { mode: "sse" | "poll"; intervalMs: number };
  defaults: { text: string | null; reasoning: string | null; code: string | null; vision: string | null; image: string | null; agent?: string | null };
  models: LiveModel[];
}

/**
 * Keeps the customer UI in sync with admin configuration.
 *  - Long-running servers: SSE (/api/config/events) pushes version changes instantly.
 *  - Serverless (Vercel): polls the tiny /api/config/version every few seconds.
 * Both also refresh on tab focus; the full catalog is refetched only when the version changes.
 */
export function useLiveConfig() {
  const [config, setConfig] = useState<LiveConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const versionRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const c = await api<LiveConfig>("/api/config");
      versionRef.current = c.version;
      setConfig(c);
      return c;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const check = async () => {
      try {
        const { version } = await api<{ version: number }>("/api/config/version");
        setConnected(true);
        if (version !== versionRef.current) void refresh();
      } catch {
        setConnected(false);
      }
    };

    void refresh().then((c) => {
      if (cancelled || !c) return;
      if (c.live?.mode === "sse" && typeof EventSource !== "undefined") {
        es = new EventSource("/api/config/events");
        es.addEventListener("version", (e) => {
          setConnected(true);
          const v = Number((e as MessageEvent).data);
          if (v && v !== versionRef.current) void refresh();
        });
        es.onerror = () => setConnected(false);
        timer = setInterval(check, c.live.intervalMs);
      } else {
        setConnected(true);
        timer = setInterval(() => document.visibilityState === "visible" && check(), c.live?.intervalMs ?? 5000);
      }
    });
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      es?.close();
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { config, refresh, connected };
}
