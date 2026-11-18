"use client";
import { CheckCircle2, ExternalLink, Github, Globe, Loader2, Plug, Settings2, Sparkles, Unlink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../ui/Modal";
import { AddConnector } from "./AddConnector";
import { useToast } from "../ui/Toast";

type Server = { id: string; slug: string; name: string; authType: string; connectedAt: string | null; lastSyncAt: string | null; lastError: string | null; toolCount: number; enabled: boolean };
type Preset = { key: string; cat: string; name: string; url: string; desc: string };
type Github = { appCreated: boolean; connected: boolean; login: string | null; avatarUrl: string | null };
type Data = { servers: Server[]; presets: Preset[]; categories: { key: string; label: string }[]; github: Github };

export function serverConnected(s: Server | undefined) {
  if (!s) return false;
  if (s.authType === "oauth" || s.authType === "github") return Boolean(s.connectedAt);
  if (s.authType === "token") return true;
  return Boolean(s.lastSyncAt && s.toolCount > 0);
}

const COLORS = ["bg-sky-500/20 text-sky-300", "bg-violet-500/20 text-violet-300", "bg-emerald-500/20 text-emerald-300", "bg-amber-500/20 text-amber-300", "bg-rose-500/20 text-rose-300", "bg-teal-500/20 text-teal-300"];
function Avatar({ name }: { name: string }) {
  const c = COLORS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLORS.length];
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${c}`}>{name.slice(0, 2)}</span>;
}

/** Claude-style connectors menu: every connector with its status and a one-tap «ربط» (full-page link → provider login). */
export function ConnectorsSheet({ open, onClose, onCount }: { open: boolean; onClose: () => void; onCount?: (n: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/admin/mcp");
      setData(d);
      onCount?.(d.servers.filter((s) => s.enabled && serverConnected(s)).length);
    } catch {
      /* not an admin */
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const back = typeof window !== "undefined" ? window.location.pathname : "/";
  const bySlug = new Map((data?.servers ?? []).map((s) => [s.slug, s]));

  async function disconnect(s: Server) {
    setBusy(s.id);
    try {
      if (s.authType === "github") await api("/api/admin/github/disconnect", { body: {} });
      else if (s.authType === "oauth") await api(`/api/admin/mcp/${s.id}/disconnect`, { body: {} });
      else await api(`/api/admin/mcp/${s.id}`, { method: "DELETE" });
      toast(`تم فصل ${s.name}`, "ok");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  }

  const gh = data?.github;
  const ghServer = bySlug.get("github");

  return (
    <Modal open={open} onClose={onClose} title="الموصّلات">
      {!data ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-5" data-testid="connectors-sheet">
          <p className="text-sm leading-6 text-slate-400">اربط حساباتك مرة وحدة، والوكيل يستخدمها لما تشغّل <b className="text-sky-300">وضع الوكيل</b>: يبني، يرفع، وينشر عنك.</p>

          {/* GitHub */}
          <div className="flex items-center gap-3 rounded-2xl border border-ink-600 bg-ink-850 p-3">
            {gh?.avatarUrl ? <img src={gh.avatarUrl} alt="" className="h-10 w-10 rounded-xl" /> : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-ink-950"><Github size={20} /></span>}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">GitHub</div>
              <div className="truncate text-xs text-slate-400">{gh?.connected ? `مربوط كـ ${gh.login}` : "مستودعات، commits، PRs، ونشر مجاني على GitHub Pages"}</div>
            </div>
            {gh?.connected ? (
              <button className="btn-ghost h-10 px-3 text-xs text-slate-400" disabled={busy === ghServer?.id} onClick={() => ghServer && disconnect(ghServer)}>
                <Unlink size={14} /> فصل
              </button>
            ) : (
              <a href={`/api/connect/github?back=${encodeURIComponent(back)}`} className="btn-primary h-10 px-4" data-testid="connect-github">
                ربط
              </a>
            )}
          </div>

          {/* Vercel: one-tap import of the agent's GitHub repo (Vercel offers no open OAuth for deploys) */}
          <div className="flex items-center gap-3 rounded-2xl border border-ink-600 bg-ink-850 p-3" data-testid="connector-vercel">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-ink-950">▲</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Vercel</div>
              <div className="text-xs leading-5 text-slate-400">{gh?.connected ? "جاهز: الوكيل يرفع موقعك على GitHub ويعطيك زر «انشر على Vercel» — ضغطة وتسجيل دخول، وبعدها كل تحديث ينشر تلقائياً" : "يشتغل عن طريق GitHub — اربط GitHub أول"}</div>
            </div>
            {gh?.connected ? <CheckCircle2 size={18} className="shrink-0 text-emerald-400" /> : null}
          </div>

          {/* built-in */}
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300"><Sparkles size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">مدمج دائماً</div>
              <div className="text-xs leading-5 text-slate-400">بحث وقراءة الويب، توليد صور، ونشر موقع فوري برابط عام — بدون أي ربط</div>
            </div>
            <CheckCircle2 size={18} className="text-emerald-400" />
          </div>

          {data.categories.map((cat) => {
            const list = data.presets.filter((p) => p.cat === cat.key);
            if (!list.length) return null;
            return (
              <section key={cat.key}>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  {cat.key === "web" ? <Globe size={13} /> : <Plug size={13} />} {cat.label}
                </h3>
                <div className="divide-y divide-ink-700 overflow-hidden rounded-2xl border border-ink-600 bg-ink-850">
                  {list.map((p) => {
                    const s = bySlug.get(p.key);
                    const on = serverConnected(s) && s!.enabled;
                    return (
                      <div key={p.key} className="flex items-center gap-3 p-3" data-testid={`connector-${p.key}`}>
                        <Avatar name={p.name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-medium">
                            {p.name}
                            {on && <span className="badge bg-emerald-500/15 text-emerald-300">مربوط{s!.toolCount ? ` · ${s!.toolCount} أداة` : ""}</span>}
                          </div>
                          <div className="line-clamp-2 text-xs leading-5 text-slate-400">{s?.lastError && !on ? <span className="text-rose-300">{s.lastError.slice(0, 120)}</span> : p.desc}</div>
                        </div>
                        {on ? (
                          <button className="btn-ghost h-10 shrink-0 px-2.5 text-xs text-slate-400" disabled={busy === s!.id} onClick={() => disconnect(s!)}>
                            {busy === s!.id ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />} فصل
                          </button>
                        ) : (
                          <a href={`/api/connect/mcp?preset=${p.key}&back=${encodeURIComponent(back)}`} className="btn-outline h-10 shrink-0 px-4" onClick={() => setBusy(p.key)}>
                            {busy === p.key ? <Loader2 size={15} className="animate-spin" /> : "ربط"}
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400"><Plug size={13} /> أضف موصّل ثاني</h3>
            <AddConnector back={back} />
          </section>

          <Link href="/admin/mcp" className="flex items-center justify-center gap-1.5 py-1 text-xs text-slate-500 hover:text-slate-300">
            <Settings2 size={13} /> رابط MCP مخصص، سجل الربط، وإعدادات متقدمة <ExternalLink size={11} />
          </Link>
        </div>
      )}
    </Modal>
  );
}
