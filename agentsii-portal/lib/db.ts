import "server-only";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Currency } from "./config";
import { useBlobStorage } from "./config";

export type HistoryType = "create" | "set" | "credit" | "debit";

export type HistoryEntry = {
  at: string;
  type: HistoryType;
  amountMinor: number;
  balanceAfterMinor: number;
  note?: string;
};

export type CustomerStatus = "active" | "suspended";

export type Customer = {
  id: string;
  number: string;
  name: string;
  pinHash: string;
  currency: Currency;
  balanceMinor: number;
  status: CustomerStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
  balanceUpdatedAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** Bumped when the PIN changes, the account is suspended or deleted, to end customer sessions. */
  sessionVersion: number;
  history: HistoryEntry[];
};

export type Database = {
  version: 1;
  customers: Customer[];
};

const BLOB_PATH = "agentsii/database.json";
const LOCAL_PATH = path.join(process.cwd(), ".data", "database.json");
const MAX_RETRIES = 5;
export const HISTORY_LIMIT = 50;

function emptyDb(): Database {
  return { version: 1, customers: [] };
}

type Snapshot = { db: Database; etag: string | null };

async function readSnapshot(): Promise<Snapshot> {
  if (!useBlobStorage()) {
    try {
      const raw = await fs.readFile(LOCAL_PATH, "utf8");
      return { db: JSON.parse(raw) as Database, etag: null };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { db: emptyDb(), etag: null };
      throw e;
    }
  }

  const res = await get(BLOB_PATH, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200) return { db: emptyDb(), etag: null };
  const raw = await new Response(res.stream).text();
  return { db: JSON.parse(raw) as Database, etag: res.blob.etag };
}

async function writeSnapshot(db: Database, etag: string | null): Promise<void> {
  const body = JSON.stringify(db);
  if (!useBlobStorage()) {
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    const tmp = `${LOCAL_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, LOCAL_PATH);
    return;
  }

  await put(BLOB_PATH, body, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}

export async function readDb(): Promise<Database> {
  return (await readSnapshot()).db;
}

export class ConflictError extends Error {}

/**
 * Applies `mutate` to the latest database and saves it with an ETag check,
 * retrying when another request wrote in between (optimistic concurrency).
 * `mutate` may return a value; throwing aborts without writing.
 */
export async function updateDb<T>(mutate: (db: Database) => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { db, etag } = await readSnapshot();
    const result = await mutate(db);
    try {
      await writeSnapshot(db, etag);
      return result;
    } catch (e) {
      const conflict =
        e instanceof BlobPreconditionFailedError ||
        // First write with allowOverwrite:false fails if another request created the file first.
        (etag === null && e instanceof Error && /already exists/i.test(e.message));
      if (!conflict) throw e;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * (attempt + 1)));
    }
  }
  throw new ConflictError("Database is busy, please retry.");
}

export function pushHistory(c: Customer, entry: HistoryEntry) {
  c.history.unshift(entry);
  if (c.history.length > HISTORY_LIMIT) c.history.length = HISTORY_LIMIT;
}
