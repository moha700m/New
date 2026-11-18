# JB AI

An AskAnything-style AI chat platform with an owner-controlled **Engine Management Center**: providers, credentials, models, routing, fallback and plan access are all configured from the admin dashboard and propagate live to customers — no code edits or redeploys.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS · PostgreSQL · Prisma · Stripe · server-side streaming.

## Architecture

```
Browser ──► /api/chat (authenticated)
              ├─ validation (zod) + per-user rate limit
              ├─ plan / quota checks (DB)
              ├─ server-side routing (RoutingConfig + model catalog in DB)
              ├─ provider adapter (Venice · OpenAI-compatible · Anthropic)
              ├─ retry once on transient error, then fallback target
              └─ NDJSON stream ─► UI; message + usage persisted
```

- **Live config**: every admin change bumps `ConfigState.version` and issues Postgres `NOTIFY jb_config`. Each server instance `LISTEN`s (3 s poll fallback) and invalidates its catalog cache; browsers subscribe to `/api/config/events` (SSE) and refetch `/api/config`, with 30 s polling + on-focus refresh as fallback.
- **Secrets**: provider keys and Stripe secrets are AES-256-GCM encrypted with `MASTER_ENCRYPTION_KEY`; APIs only ever return the last 4 characters.
- **Customers can only choose a catalog model id.** Base URLs, credentials and providers are never client-controlled.
- **Payments**: Stripe hosted Checkout with inline prices from the plan table; subscriptions activate only from signature-verified, idempotent webhooks.

Key code: `src/lib/engine.ts` (sync, catalog, routing), `src/lib/gateway.ts` (AI gateway), `src/lib/providers/*` (adapters), `src/lib/config-bus.ts` (live updates), `src/lib/payments/index.ts` (Stripe).

## Local development

```bash
cp .env.example .env          # fill DATABASE_URL, MASTER_ENCRYPTION_KEY, OWNER_EMAIL
npm install
npx prisma migrate deploy && npm run db:seed
npm run dev
```

Register with `OWNER_EMAIL` → you are the owner. Then in **Admin → AI Providers** add the Venice API key, **Sync models**, and in **AI Engines** click **Apply Venice suggested defaults** (uses `GET /models/traits`).

## Tests

```bash
npm run build && npm start &
OWNER_EMAIL=owner@example.com npm run test:e2e   # 43 end-to-end checks against real providers
```

## Deploy (Render)

`render.yaml` defines a Node web service + managed PostgreSQL (paid DB plans include daily backups). Required env: `DATABASE_URL`, `MASTER_ENCRYPTION_KEY`, `APP_URL`, `OWNER_EMAIL`. Optional: `SMTP_URL`, `MAIL_FROM`, `STRIPE_*`. Start command runs migrations and the idempotent seed before `next start`. Health check: `/api/health`.

Stripe webhook endpoint: `https://<your-domain>/api/webhooks/stripe` — events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
