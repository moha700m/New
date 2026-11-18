import "server-only";
import { Client } from "pg";
import { prisma } from "./db";

/**
 * Live configuration bus.
 *
 * Every admin change to providers / models / routing / plans calls `bumpConfigVersion()`, which
 *   1. increments ConfigState.version in Postgres (source of truth),
 *   2. issues `NOTIFY jb_config` so every server instance learns about it instantly,
 *   3. invalidates this instance's in-memory caches.
 * Server instances keep one LISTEN connection; a 3s DB poll is the safety net if LISTEN drops.
 * Browsers subscribe to /api/config/events (SSE) and refetch /api/config when the version changes;
 * they also poll as a fallback.
 */

type Listener = (version: number) => void;

interface BusState {
  version: number;
  listeners: Set<Listener>;
  started: boolean;
  pgClient: Client | null;
  invalidators: Set<() => void>;
}

const g = globalThis as unknown as { __jbConfigBus?: BusState };
const bus: BusState = (g.__jbConfigBus ??= {
  version: 0,
  listeners: new Set(),
  started: false,
  pgClient: null,
  invalidators: new Set(),
});

export async function readVersion(): Promise<number> {
  const row = await prisma.configState.upsert({ where: { id: "global" }, create: { id: "global", version: 1 }, update: {} });
  return row.version;
}

function setVersion(v: number) {
  if (v === bus.version) return;
  bus.version = v;
  for (const inv of bus.invalidators) inv();
  for (const l of bus.listeners) {
    try {
      l(v);
    } catch {}
  }
}

async function connectListener() {
  if (!process.env.DATABASE_URL) return;
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", () => {
      bus.pgClient = null;
      setTimeout(connectListener, 5000);
    });
    client.on("end", () => {
      if (bus.pgClient === client) {
        bus.pgClient = null;
        setTimeout(connectListener, 5000);
      }
    });
    await client.connect();
    await client.query("LISTEN jb_config");
    client.on("notification", (msg) => {
      const v = Number(msg.payload);
      if (Number.isFinite(v)) setVersion(v);
    });
    bus.pgClient = client;
  } catch (e) {
    console.warn("[config-bus] LISTEN unavailable, relying on polling", (e as Error).message);
    setTimeout(connectListener, 15000);
  }
}

export function ensureBusStarted() {
  if (bus.started) return;
  bus.started = true;
  readVersion().then(setVersion).catch(() => {});
  void connectListener();
  const t = setInterval(() => {
    readVersion().then(setVersion).catch(() => {});
  }, 3000);
  (t as unknown as { unref?: () => void }).unref?.();
}

export function currentVersion() {
  return bus.version;
}

export function onConfigChange(l: Listener): () => void {
  ensureBusStarted();
  bus.listeners.add(l);
  return () => bus.listeners.delete(l);
}

/** Register a cache invalidator, called whenever the config version changes. */
export function registerInvalidator(fn: () => void) {
  bus.invalidators.add(fn);
}

export async function bumpConfigVersion(): Promise<number> {
  const row = await prisma.configState.upsert({
    where: { id: "global" },
    create: { id: "global", version: 2 },
    update: { version: { increment: 1 } },
  });
  setVersion(row.version);
  try {
    await prisma.$executeRawUnsafe(`SELECT pg_notify('jb_config', $1)`, String(row.version));
  } catch (e) {
    console.warn("[config-bus] NOTIFY failed", (e as Error).message);
  }
  return row.version;
}
