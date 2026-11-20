import "server-only";

export const BRAND = "Agentsii";

export { CURRENCIES, isCurrency, type Currency } from "./currencies";
import { isCurrency, type Currency } from "./currencies";

export function defaultCurrency(): Currency {
  const v = (process.env.DEFAULT_CURRENCY ?? "USD").toUpperCase();
  return isCurrency(v) ? v : "USD";
}

export function appTimezone(): string {
  return process.env.APP_TIMEZONE || "Asia/Riyadh";
}

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters.");
  }
  return secret;
}

export function adminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 12) {
    throw new Error("ADMIN_PASSWORD is missing or shorter than 12 characters.");
  }
  return pw;
}

/** Vercel Blob is used whenever a token is configured; local file storage is only allowed in development. */
export function useBlobStorage(): boolean {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return true;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Vercel Blob is not configured (BLOB_READ_WRITE_TOKEN).");
  }
  return false;
}
