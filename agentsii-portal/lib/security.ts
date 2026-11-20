import "server-only";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

function scrypt(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret, salt, KEY_LEN, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns "scrypt$<salt>$<hash>" (base64url). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Used when a customer number does not exist so response time does not reveal that.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  const [algo, saltB64, hashB64] = (stored ?? DUMMY_HASH).split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(secret, Buffer.from(saltB64, "base64url"));
  return stored != null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function safeEqualString(a: string, b: string): boolean {
  // Compare HMAC digests so lengths always match and timing does not leak length.
  const key = randomBytes(32);
  const da = createHmac("sha256", key).update(a).digest();
  const db = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(da, db);
}

export function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/* ---------------- in-memory throttling (per server instance) ---------------- */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Returns false when the key exceeded `limit` attempts within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
