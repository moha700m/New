import "server-only";
import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (provider API keys, payment secrets).
 * MASTER_ENCRYPTION_KEY must be 32 bytes, base64 or hex encoded. It never leaves the server.
 */
function masterKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY;
  if (!raw) throw new Error("MASTER_ENCRYPTION_KEY is not configured");
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, ivB, tagB, dataB] = payload.split(":");
  if (v !== "v1" || !ivB || !tagB || !dataB) throw new Error("Unsupported secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

export function last4(secret: string): string {
  return secret.length <= 4 ? "****" : secret.slice(-4);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
