import "server-only";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";

type Ledger = { amount: number; currency: string; timestamp: string; inferenceDetails?: { requestId?: string } | null };
export type SpendInfo = {
  available: boolean;
  balanceUsd: number | null;
  bundledCredits: number | null;
  diem: number | null;
  spentTodayUsd: number;
  spent7dUsd: number;
  spent30dUsd: number;
  creditsAdded30dUsd: number;
  requestsToday: number;
  avgPerMessageUsd: number | null;
  remainingMessages: number | null;
  lastMessageUsd: number | null;
  updatedAt: string;
  error?: string;
};

let cache: { at: number; data: SpendInfo } | null = null;

/** Start of "today" in Riyadh (UTC+3) as a UTC Date. */
function riyadhMidnight() {
  const now = Date.now() + 3 * 3600_000;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 3 * 3600_000);
}

/** Venice balance + spending from Venice's own billing ledger (account-wide, exact). Cached 45 s. */
export async function getSpend(force = false): Promise<SpendInfo> {
  if (!force && cache && Date.now() - cache.at < 45_000) return cache.data;
  const base: SpendInfo = { available: false, balanceUsd: null, bundledCredits: null, diem: null, spentTodayUsd: 0, spent7dUsd: 0, spent30dUsd: 0, creditsAdded30dUsd: 0, requestsToday: 0, avgPerMessageUsd: null, remainingMessages: null, lastMessageUsd: null, updatedAt: new Date().toISOString() };
  const p = await prisma.provider.findFirst({ where: { type: "VENICE", apiKeyEncrypted: { not: null } }, orderBy: { priority: "asc" } });
  if (!p?.apiKeyEncrypted) return { ...base, error: "ما فيه مفتاح Venice" };
  const key = decryptSecret(p.apiKeyEncrypted);
  const root = (p.baseUrl || "https://api.venice.ai/api/v1").replace(/\/$/, "");
  const get = async (path: string) => {
    const r = await fetch(`${root}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!r.ok) throw new Error(`Venice ${r.status}`);
    return r.json();
  };
  try {
    const bal = await get("/billing/balance");
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows: Ledger[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 8; i++) {
      const page: { data: Ledger[]; nextCursor?: string | null } = await get(`/billing/usage-history?pageSize=500&startTimestamp=${encodeURIComponent(since)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      rows.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
      if (!cursor) break;
    }
    const today = riyadhMidnight().getTime();
    const week = Date.now() - 7 * 86400_000;
    const spend = rows.filter((r) => r.amount < 0);
    const sum = (list: Ledger[]) => list.reduce((n, r) => n - r.amount, 0);
    // group ledger lines (input/output/etc.) into requests
    const byReq = new Map<string, { usd: number; at: number }>();
    for (const r of spend) {
      const id = r.inferenceDetails?.requestId ?? `${r.timestamp}`;
      const e = byReq.get(id) ?? { usd: 0, at: 0 };
      e.usd -= r.amount;
      e.at = Math.max(e.at, Date.parse(r.timestamp));
      byReq.set(id, e);
    }
    const reqs = [...byReq.values()].sort((a, b) => b.at - a.at);
    const recent = reqs.slice(0, 100);
    const avg = recent.length ? recent.reduce((n, r) => n + r.usd, 0) / recent.length : null;
    const balanceUsd = Number(bal?.balances?.usd ?? 0) + Number(bal?.balances?.bundledCredits ?? 0);
    const data: SpendInfo = {
      ...base,
      available: true,
      balanceUsd,
      bundledCredits: bal?.balances?.bundledCredits ?? null,
      diem: bal?.balances?.diem ?? null,
      spentTodayUsd: sum(spend.filter((r) => Date.parse(r.timestamp) >= today)),
      spent7dUsd: sum(spend.filter((r) => Date.parse(r.timestamp) >= week)),
      spent30dUsd: sum(spend),
      creditsAdded30dUsd: rows.filter((r) => r.amount > 0 && r.currency === "USD").reduce((n, r) => n + r.amount, 0),
      requestsToday: reqs.filter((r) => r.at >= today).length,
      avgPerMessageUsd: avg,
      remainingMessages: avg && avg > 0 ? Math.floor(balanceUsd / avg) : null,
      lastMessageUsd: reqs[0]?.usd ?? null,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
