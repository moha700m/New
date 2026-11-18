#!/usr/bin/env bash
# Vercel build: generate client, apply migrations + idempotent seed when a database is connected, then build.
set -euo pipefail
export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
npx prisma generate
if [ -n "${DATABASE_URL:-}" ]; then
  npx prisma migrate deploy
  npx tsx prisma/seed.ts
else
  echo "WARNING: DATABASE_URL is not set. Connect a Postgres database (Vercel → Storage → Neon) and redeploy."
fi
npx next build
