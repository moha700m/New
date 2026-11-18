"use client";
import { CreditCard, LogOut, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Settings, Shield, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../Logo";

export interface ConvItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface MeInfo {
  user: { id: string; email: string; name: string | null; role: string; isAdmin: boolean; mustVerify: boolean; emailVerifiedAt: string | null } | null;
  plan?: { key: string; name: string; dailyMessageLimit: number | null; allowUploads: boolean; allowWebSearch: boolean; allowImageGeneration: boolean; maxUploadMb: number };
  usage?: { messagesToday: number; messagesThisMonth: number; tokensThisMonth: number };
  subscription?: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
}

function groupLabel(d: string) {
  const days = (Date.now() - new Date(d).getTime()) / 864e5;
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function Sidebar(props: {
  siteName: string;
  me: MeInfo | null;
  conversations: ConvItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSearch: (q: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [userMenu, setUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = props.me?.user;

  useEffect(() => {
    const t = setTimeout(() => props.onSearch(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
        setUserMenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  let lastGroup = "";
  return (
    <>
      {props.open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={props.onClose} />}
      <aside
        ref={menuRef}
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-ink-700 bg-ink-950/95 backdrop-blur transition-transform md:static md:translate-x-0 ${props.open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <Link href="/" onClick={props.onNew}>
            <Logo name={props.siteName} />
          </Link>
          <button className="btn-ghost p-1.5 md:hidden" onClick={props.onClose} aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>
        <nav className="space-y-0.5 px-2.5 py-2">
          <button className="btn-ghost w-full justify-start px-2.5" onClick={props.onNew} data-testid="new-chat">
            <Plus size={17} /> New chat
          </button>
          {user && (
            searching ? (
              <div className="flex items-center gap-1 px-1">
                <input className="input py-1.5" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <button className="btn-ghost p-1.5" onClick={() => { setSearching(false); setQ(""); }} aria-label="Close search">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button className="btn-ghost w-full justify-start px-2.5" onClick={() => setSearching(true)}>
                <Search size={16} /> Search chats
              </button>
            )
          )}
          <Link href="/plans" className="btn-ghost w-full justify-start px-2.5 text-emerald-300 hover:text-emerald-200">
            <CreditCard size={16} /> Plans & pricing
          </Link>
        </nav>
        <div className="mt-2 flex-1 overflow-y-auto px-2.5 pb-3">
          {!user && <p className="px-2.5 pt-2 text-sm text-slate-500">Sign in to keep your chats saved securely across devices.</p>}
          {user && !props.conversations.length && <p className="px-2.5 pt-2 text-sm text-slate-500">{q ? "No chats found." : "No chats yet."}</p>}
          {props.conversations.map((c) => {
            const g = groupLabel(c.updatedAt);
            const header = g !== lastGroup ? ((lastGroup = g), <div key={g + "h"} className="px-2.5 pb-1 pt-3 text-xs font-medium text-slate-500">{g}</div>) : null;
            return (
              <div key={c.id}>
                {header}
                <div className={`group relative flex items-center rounded-lg ${props.activeId === c.id ? "bg-ink-700" : "hover:bg-ink-800"}`}>
                  {renaming === c.id ? (
                    <form
                      className="flex-1 p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (renameText.trim()) props.onRename(c.id, renameText.trim());
                        setRenaming(null);
                      }}
                    >
                      <input className="input py-1" value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus onBlur={() => setRenaming(null)} />
                    </form>
                  ) : (
                    <button className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-slate-200" onClick={() => props.onSelect(c.id)}>
                      <MessageSquare size={14} className="shrink-0 text-slate-500" />
                      <span className="truncate">{c.title}</span>
                    </button>
                  )}
                  {renaming !== c.id && (
                    <button
                      className="mr-1 rounded p-1 text-slate-400 opacity-100 hover:bg-ink-600 hover:text-white md:opacity-0 md:group-hover:opacity-100"
                      onClick={() => setMenu(menu === c.id ? null : c.id)}
                      aria-label="Conversation options"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                  {menu === c.id && (
                    <div className="absolute right-1 top-9 z-50 w-40 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-xl">
                      <button className="btn-ghost w-full justify-start px-2 py-1.5" onClick={() => { setRenaming(c.id); setRenameText(c.title); setMenu(null); }}>
                        <Pencil size={14} /> Rename
                      </button>
                      <button className="btn-ghost w-full justify-start px-2 py-1.5 text-red-300 hover:text-red-200" onClick={() => { setMenu(null); if (confirm("Delete this conversation?")) props.onDelete(c.id); }}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-ink-700 p-2.5">
          {user ? (
            <div className="relative">
              {userMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-xl">
                  <Link href="/settings" className="btn-ghost w-full justify-start px-2 py-1.5"><Settings size={15} /> Settings</Link>
                  <Link href="/settings?tab=billing" className="btn-ghost w-full justify-start px-2 py-1.5"><CreditCard size={15} /> Subscription</Link>
                  {user.isAdmin && <Link href="/admin" className="btn-ghost w-full justify-start px-2 py-1.5"><Shield size={15} /> Admin dashboard</Link>}
                  <button className="btn-ghost w-full justify-start px-2 py-1.5" onClick={props.onLogout}><LogOut size={15} /> Log out</button>
                </div>
              )}
              <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-ink-800" onClick={() => setUserMenu((s) => !s)} data-testid="user-menu">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-violet-400 text-sm font-semibold text-ink-950">
                  {(user.name || user.email)[0]!.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{user.name || user.email}</span>
                  <span className="block text-xs text-slate-500">
                    {props.me?.plan?.name} plan
                    {props.me?.plan?.dailyMessageLimit != null && ` · ${props.me.usage?.messagesToday ?? 0}/${props.me.plan.dailyMessageLimit} today`}
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
              <p className="text-sm font-semibold">Chat with {props.siteName}</p>
              <p className="mt-1 text-xs text-slate-400">Create a free account to start chatting. Upgrade any time for more models and web search.</p>
              <Link href="/register" className="btn-primary mt-3 w-full">Sign up free</Link>
              <Link href="/login" className="btn-outline mt-2 w-full">Log in</Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
