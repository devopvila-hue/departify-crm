# DEPARTIFY CRM

> Operational CRM. Multi-tenant. Multi-purpose. Customer zero: DEPARTIFY.

This repository contains the standalone CRM that DEPARTIFY uses to manage
its own commercial operations and that other PYMEs (and DEPARTIFY itself,
for downstream customers) can deploy as the canonical system of work.

The CRM is intentionally **not** a generic Salesforce clone and **not** an
AI assistant. It is a deterministic data + execution engine that stores
contacts, companies, pipelines and deals, schedules outreach, sends
email through pluggable providers, and exposes a stable API that
DEPARTIFY can drive.

## Deploy (production) — Vercel + Railway + Supabase

The CRM is split across three providers, each doing one job well:

- **Frontend (apps/web)** → **Vercel**. Static SPA, auto-deploys on push to `main`.
- **API (apps/api)** → **Railway**. Docker container running Fastify, auto-deploys on push to `main`.
- **Postgres** → **Supabase**. Managed Postgres (free tier). The CRM only uses the SQL engine — no Supabase Auth, no Supabase Storage, no Realtime. Connection string is plain Postgres, so the DB is portable to Railway Postgres or self-hosted if needed.

This mirrors the `devopvila-hue/departify-brand-manual` flow: GitHub is the source of truth, each provider auto-deploys from it.

### One-time setup

1. **GitHub** — already done. Repo: https://github.com/devopvila-hue/departify-crm.
2. **Supabase** — create a project, then in *Project Settings → Database → Connection string → Direct*, copy the URI. You'll get something like:
   ```
   postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
   ```
   This is the `DATABASE_URL` for both the API and the migrations. Use the **direct** connection (port 5432), not the pooler, so Drizzle migrations work.
3. **Railway** — create a new project → "Deploy from GitHub repo" → `devopvila-hue/departify-crm`. Set the **root directory** to `docker/`. Override the Dockerfile path if needed; the relevant one is `docker/api.Dockerfile`. Set the env vars below. The first deploy will build the API and the worker. Add a Postgres volume or — recommended — point `DATABASE_URL` at the Supabase project so you only pay for one DB.
4. **Vercel** — "Add New Project" → import `devopvila-hue/departify-crm`. Set **Root Directory** to `apps/web` and the **Build Command** to `pnpm build` (it'll fall through to the workspace `build` script which compiles the API too — Vercel just needs the resulting `apps/web/dist`). Set the env vars below. Auto-deploy on push is on by default.

### Env vars per service

**Railway (api):**
```
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
APP_BASE_URL=https://api.<your-railway-domain>.up.railway.app
WEB_ORIGIN=https://<your-vercel-app>.vercel.app
DATABASE_URL=<supabase direct connection string>
SESSION_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
LOG_LEVEL=info
RATE_LIMIT_DEFAULT_MAX=300
RATE_LIMIT_DEFAULT_WINDOW=1 minute
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_AUTH_WINDOW=1 minute
```

**Vercel (web):**
```
# Vite reads VITE_*-prefixed vars at build time. The frontend
# talks to the API via the Railway URL.
VITE_API_BASE_URL=https://api.<your-railway-domain>.up.railway.app/api
```

### One-time bootstrap after first deploy

```bash
# 1. Apply migrations against the Supabase DB.
# Run from your machine with the same DATABASE_URL Railway uses:
DATABASE_URL=<supabase url> pnpm --filter=@departify-crm/db migrate

# 2. Seed the demo organization.
DATABASE_URL=<supabase url> pnpm --filter=@departify-crm/db seed
# Demo login: demo@departify.app / departify-demo-2026
```

For production, delete the seed user from the DB and create your own via the public `/api/v1/auth/signup` endpoint (or build a small admin CLI in a later sprint).

## Quick start (local)

```bash
# Prereqs: Node 22+, pnpm 10+, PostgreSQL 16+ running locally.
cp apps/api/.env.example apps/api/.env
# Edit SESSION_SECRET and ENCRYPTION_KEY (any two 32+ char strings).

pnpm install
pnpm --filter=@departify-crm/db build
pnpm --filter=@departify-crm/shared build
pnpm --filter=@departify-crm/api build
pnpm --filter=@departify-crm/web build

# 1) Create the database
createdb departify_crm

# 2) Apply migrations
pnpm --filter=@departify-crm/db migrate

# 3) Seed a demo organization (safe — uses fake data, no real emails)
pnpm --filter=@departify-crm/db seed
# Demo login:
#   email:    demo@departify.app
#   password: departify-demo-2026

# 4) Run the API and web app
pnpm dev:api   # http://localhost:4000  (OpenAPI at /openapi.json, Swagger UI at /docs)
pnpm dev:web   # http://localhost:5173
```

## What's in this sprint

This is **sprint 1 of 8**. The repository ships:

- **Foundation.** Postgres schema, multi-tenant data model, migrations, seed.
- **Auth.** Email + password with Argon2id, httpOnly session cookies,
  RBAC for owner / admin / member, plus a service-key path for
  DEPARTIFY and other automation.
- **Core API.** Organizations, contacts, companies, pipelines, stages,
  deals (incl. move), tags, notes, tasks, custom fields, audit log,
  global search, and an operational `/attention` endpoint.
- **Frontend.** Vite + React + TypeScript with a DEPARTIFY-aligned
  design system (Instrument Sans + JetBrains Mono, calm ink + lime
  palette, no AI-default cream + terracotta). Auth, home, contacts
  list + detail, companies list + detail, Kanban pipeline, tasks,
  and the integrations (service keys) screen.
- **OpenAPI.** Machine-readable API at `/openapi.json`, with a Swagger
  UI at `/docs`.
- **Tests.** Cross-tenant isolation (the most important quality gate
  of the entire system) and a CRUD smoke for contacts + deals.
- **Docker.** `docker compose up` brings up Postgres + API + web. Not
  validated in this machine because Docker isn't installed; the
  compose file is intended for Linux deploys.

## What's NOT in this sprint (and the next ones)

- CSV import / export (Phase 4)
- Bulk operations at scale (Phase 4)
- Lists / segments (Phase 4)
- Email providers (Resend, Brevo) (Phase 5)
- Sequences + worker (Phase 6)
- Sequence analytics, stop-on-reply, bounce handling (Phase 6)
- Frontend polish: empty states on every screen, dark mode,
  mobile Kanban, full timeline interactions (Phase 7)
- Departify integration contract finalisation + Customer Zero
  end-to-end run (Phase 8)

## Layout

```
apps/
  api/        Fastify + Drizzle backend
  web/        Vite + React + Tailwind frontend
packages/
  db/         Drizzle schema, migrations, seed
  shared/     Cross-package types, error contract, filter language
docker/       Dockerfiles + nginx config
docs/         Architecture + integration notes
```

## License

Internal / proprietary. The repository is private; distribution rules
are decided in a later sprint.
