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
  capabilities: { vision: boolean; webSearch: boolean; reasoning: boolean; tools: boolean; imageGeneration: boolean; code: boolean; streaming: boolean; structuredOutput: boolean };
  plans: string[];
  allowed: boolean;
}

export interface LiveConfig {
  version: number;
  site: { name: string; tagline: string; maintenanceMode: boolean; registrationOpen: boolean };
  planKey: string | null;
  defaults: { text: string | null; reasoning: string | null; code: string | null; vision: string | null; image: string | null };
  models: LiveModel[];
}

/**
 * Keeps the customer UI in sync with admin configuration:
 *  - SSE (/api/config/events) pushes version changes in real time,
 *  - polling every 30s + on tab focus is the fallback.
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
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/config/events");
      es.addEventListener("version", (e) => {
        setConnected(true);
        const v = Number((e as MessageEvent).data);
        if (v && v !== versionRef.current) void refresh();
      });
      es.onerror = () => setConnected(false);
    } catch {}
    const poll = setInterval(refresh, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      es?.close();
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { config, refresh, connected };
}
