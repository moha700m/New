#!/usr/bin/env bash
# Vercel build: generate client, apply migrations + idempotent seed when a database is connected, then build.
# When DB_SCHEMA is set, JB AI's tables live in that schema (other apps sharing the database are untouched).
set -euo pipefail
export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
npx prisma generate
if [ -n "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$(node scripts/db-url.mjs "$DATABASE_URL")"
  export DATABASE_URL_UNPOOLED="$(node scripts/db-url.mjs "$DATABASE_URL_UNPOOLED")"
  npx prisma migrate deploy
  npx tsx prisma/seed.ts
else
  echo "WARNING: DATABASE_URL is not set. Connect a Postgres database (Vercel → Storage → Neon) and redeploy."
fi
npx next build
