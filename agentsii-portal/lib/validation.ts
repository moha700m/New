import { normalizeDigits } from "./money";

export type FormState = { ok?: boolean; error?: string; message?: string; at?: number };

export function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Customer numbers: digits only, 1–20 characters (Arabic digits accepted and normalized). */
export function parseCustomerNumber(raw: string): string | null {
  const s = normalizeDigits(raw);
  return /^\d{1,20}$/.test(s) ? s : null;
}

/** PIN: 4–8 digits. */
export function parsePin(raw: string): string | null {
  const s = normalizeDigits(raw);
  return /^\d{4,8}$/.test(s) ? s : null;
}

export function parseName(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 80 ? s : null;
}

export function parseNote(raw: string): string | undefined {
  const s = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return s || undefined;
}
