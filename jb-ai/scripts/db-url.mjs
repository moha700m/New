// Rewrites a Postgres URL so JB AI lives in its own schema (DB_SCHEMA), isolated from other apps sharing the database.
// Also marks Neon/PgBouncer pooled URLs with pgbouncer=true so Prisma avoids prepared-statement caching.
export function withSchema(raw, schema = process.env.DB_SCHEMA) {
  if (!raw) return raw;
  const u = new URL(raw);
  if (schema) u.searchParams.set("schema", schema);
  if (/-pooler\./.test(u.hostname) && !u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
  return u.toString();
}

if (process.argv[1] && process.argv[1].endsWith("db-url.mjs")) {
  process.stdout.write(withSchema(process.argv[2] || "", process.argv[3] || process.env.DB_SCHEMA) || "");
}
