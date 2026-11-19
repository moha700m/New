"use client";
import { AtSign, Boxes, Globe, Image as ImageIcon, Link2, Plug, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BUILTIN_MENTIONS, CONNECTOR_ALIASES, connectorToken, type MentionKind } from "@/lib/mentions";
import { api } from "../api";

export interface MentionItem {
  key: string;
  token: string;
  label: string;
  desc: string;
  kind: MentionKind;
  aliases: string[];
  connected: boolean;
  /** where «ربط» goes when not connected */
  connectUrl?: string;
}

type Server = { id: string; slug: string; name: string; authType: string; connectedAt: string | null; lastSyncAt: string | null; toolCount: number; enabled: boolean };
type Preset = { key: string; name: string; desc: string };
type Data = { servers: Server[]; presets: Preset[]; github: { connected: boolean } };

function isConnected(s: Server | undefined) {
  if (!s || !s.enabled) return false;
  if (s.authType === "oauth" || s.authType === "github") return Boolean(s.connectedAt);
  if (s.authType === "token") return true;
  return Boolean(s.lastSyncAt && s.toolCount > 0);
}

/** Everything the user can @mention: built-in tools, deploy targets and every connector (with its live status). */
export function useMentionCatalog(enabled: boolean) {
  const [items, setItems] = useState<MentionItem[]>([]);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = await api<Data>("/api/admin/mcp");
      const back = encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/");
      const bySlug = new Map(d.servers.map((s) => [s.slug, s]));
      const ghUrl = `/api/connect/github?back=${back}`;
      const list: MentionItem[] = BUILTIN_MENTIONS.map((b) => ({
        key: b.key,
        token: b.token,
        label: b.label,
        desc: b.desc,
        kind: b.kind,
        aliases: b.aliases,
        connected: b.needs === "github" ? Boolean(d.github?.connected) : b.needs ? isConnected(bySlug.get(b.needs)) : true,
        connectUrl: b.needs === "github" ? ghUrl : b.needs ? `/api/connect/mcp?preset=${b.needs}&back=${back}` : undefined,
      }));
      const seen = new Set(BUILTIN_MENTIONS.map((b) => b.key));
      for (const p of d.presets) {
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        list.push({ key: p.key, token: connectorToken(p.name, p.key), label: p.name, desc: p.desc, kind: "connector", aliases: [p.key, ...(CONNECTOR_ALIASES[p.key] ?? [])], connected: isConnected(bySlug.get(p.key)), connectUrl: `/api/connect/mcp?preset=${p.key}&back=${back}` });
      }
      for (const s of d.servers) {
        if (seen.has(s.slug) || s.authType === "github") continue;
        seen.add(s.slug);
        list.push({ key: s.slug, token: connectorToken(s.name, s.slug), label: s.name, desc: "موصّل مخصّص", kind: "connector", aliases: [s.slug], connected: isConnected(s), connectUrl: "/admin/mcp" });
      }
      // connected first inside each kind
      const order: Record<MentionKind, number> = { deploy: 0, builtin: 1, connector: 2 };
      list.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.connected) - Number(a.connected));
      setItems(list);
    } catch {
      /* not an admin: no mentions */
    }
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { items, reload: load };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
export function filterMentions(items: MentionItem[], q: string) {
  const n = norm(q);
  if (!n) return items;
  const score = (it: MentionItem) => {
    const keys = [it.label, it.token, it.key, ...it.aliases].map(norm);
    if (keys.some((k) => k.startsWith(n))) return 0;
    if (keys.some((k) => k.includes(n))) return 1;
    if (norm(it.desc).includes(n)) return 2;
    return 9;
  };
  return items
    .map((it) => [it, score(it)] as const)
    .filter(([, s]) => s < 9)
    .sort((a, b) => a[1] - b[1])
    .map(([it]) => it);
}

function Icon({ it }: { it: MentionItem }) {
  const cls = "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl";
  if (it.key === "appdeploy") return <span className={`${cls} bg-orange-500/15 text-orange-300`}><Boxes size={17} /></span>;
  if (it.key === "site") return <span className={`${cls} bg-emerald-500/15 text-emerald-300`}><Rocket size={17} /></span>;
  if (it.key === "search") return <span className={`${cls} bg-sky-500/15 text-sky-300`}><Globe size={17} /></span>;
  if (it.key === "image") return <span className={`${cls} bg-fuchsia-500/15 text-fuchsia-300`}><ImageIcon size={17} /></span>;
  if (it.kind === "deploy") return <span className={`${cls} bg-violet-500/15 text-violet-300`}><Rocket size={17} /></span>;
  return <span className={`${cls} bg-ink-700 text-[12px] font-bold text-slate-200`}>{it.label.slice(0, 2)}</span>;
}

const GROUP: Record<MentionKind, string> = { deploy: "انشر على", builtin: "أدوات", connector: "الموصّلات" };

/** The @ autocomplete list (opens above the composer). */
export function MentionPopover({ items, active, onPick, onHover, query }: { items: MentionItem[]; active: number; onPick: (it: MentionItem) => void; onHover: (i: number) => void; query: string }) {
  useEffect(() => {
    document.querySelector(`[data-mention-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let last: MentionKind | null = null;
  return (
    <div className="absolute bottom-full start-0 end-0 z-40 mb-2 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl" role="listbox" data-testid="mention-popover" dir="rtl">
      <div className="flex items-center gap-1.5 border-b border-ink-700 px-3 py-2 text-[12px] text-slate-400">
        <AtSign size={13} /> اذكر أداة أو مكان النشر{query ? <span className="text-slate-500"> · «{query}»</span> : null}
      </div>
      <div className="max-h-[min(46vh,320px)] overflow-y-auto overscroll-contain p-1.5">
        {!items.length && <div className="px-3 py-4 text-center text-sm text-slate-500">ما فيه أداة بهالاسم</div>}
        {items.map((it, i) => {
          const header = it.kind !== last ? ((last = it.kind), <div key={`h-${it.kind}`} className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-slate-500">{GROUP[it.kind]}</div>) : null;
          return (
            <div key={it.key}>
              {header}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                data-mention-index={i}
                data-testid={`mention-${it.key}`}
                className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-start ${i === active ? "bg-ink-700" : "hover:bg-ink-800"}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(it)}
              >
                <Icon it={it} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
                    <span dir="auto">@{it.label}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${it.connected ? "bg-emerald-400" : "bg-amber-400"}`} title={it.connected ? "مربوط" : "مو مربوط"} />
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-500">{it.connected ? it.desc : `مو مربوط — ${it.desc}`}</span>
                </span>
                {!it.connected && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">يحتاج ربط</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A picked mention above the text box; not-connected ones carry an inline «ربط». */
export function MentionChip({ it, onRemove }: { it: MentionItem; onRemove: () => void }) {
  return (
    <span
      className={`flex h-8 shrink-0 items-center gap-1 rounded-full ps-2.5 pe-1.5 text-[13px] font-medium ring-1 ${it.connected ? "bg-sky-500/15 text-sky-200 ring-sky-500/30" : "bg-amber-500/15 text-amber-200 ring-amber-500/40"}`}
      data-testid={`mention-chip-${it.key}`}
    >
      {it.kind === "connector" ? <Plug size={13} /> : it.kind === "deploy" ? <Rocket size={13} /> : <AtSign size={13} />}
      <span dir="auto">@{it.label}</span>
      {!it.connected && it.connectUrl && (
        <a href={it.connectUrl} className="ms-1 flex items-center gap-0.5 rounded-full bg-amber-400 px-2 py-0.5 text-[11.5px] font-semibold text-ink-950" data-testid={`mention-connect-${it.key}`}>
          <Link2 size={11} /> ربط
        </a>
      )}
      <button type="button" className="rounded-full p-0.5 opacity-70 hover:opacity-100" onClick={onRemove} aria-label={`إزالة @${it.label}`}>
        <X size={12} />
      </button>
    </span>
  );
}

/** Renders "@Token" words in a sent message as small chips. */
export function withMentionChips(text: string) {
  const parts = text.split(/((?:^|(?<=[\s(«"'،,]))@[\p{L}\p{N}._-]{2,40})/u);
  return parts.map((p, i) =>
    /^@[\p{L}\p{N}._-]{2,40}$/u.test(p) ? (
      <span key={i} className="mx-0.5 inline-flex items-center rounded-md bg-sky-500/20 px-1.5 text-[0.92em] font-medium text-sky-200" dir="auto">
        {p}
      </span>
    ) : (
      p
    ),
  );
}
