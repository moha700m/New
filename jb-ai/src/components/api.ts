"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(data?.error || `تعذّر الطلب (${res.status})`, res.status, data?.code);
  return data as T;
}

/** Arabic UI with Western digits and the Gregorian calendar (common in Saudi product UIs). */
export const LOCALE = "ar-SA-u-ca-gregory-nu-latn";

export function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat(LOCALE).format(n);
}
export function fmtUsd(n: number | null | undefined, digits = 4) {
  if (n == null) return "—";
  return "$" + n.toFixed(n >= 100 ? 2 : digits);
}
export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return "—";
  const dt = new Date(d);
  return withTime ? dt.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" }) : dt.toLocaleDateString(LOCALE, { dateStyle: "medium" });
}
export function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
