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

## Deploy (production) — Railway + Supabase

The CRM runs as **one container** that serves both the API and the SPA. Two providers, not three:

- **API + SPA together** → **Railway**. One Docker container, one domain, no CORS, native cookies. Auto-deploys on push to `main`.
- **Postgres** → **Supabase**. Managed Postgres (free tier). The CRM only uses the SQL engine — no Supabase Auth, no Supabase Storage, no Realtime. Connection string is plain Postgres, so the DB is portable to Railway Postgres or self-hosted if needed.

This mirrors the `devopvila-hue/departify-brand-manual` flow: GitHub is the source of truth, Railway auto-deploys from it.

### One-time setup

1. **GitHub** — already done. Repo: https://github.com/devopvila-hue/departify-crm.
2. **Supabase** — create a project, then in *Project Settings → Database → Connection string → Direct*, copy the URI. You'll get something like:
   ```
   postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
   ```
   This is the `DATABASE_URL` for both the API and the migrations. Use the **direct** connection (port 5432), not the pooler, so Drizzle migrations work.
3. **Railway** — create a new project → "Deploy from GitHub repo" → `devopvila-hue/departify-crm`. In the service settings:
   - **Settings → Build → Builder**: switch from `Nixpacks` to `Dockerfile`.
   - **Dockerfile path**: `docker/api.Dockerfile`.
   - **Build context**: `.` (repo root).
   - **Healthcheck Path**: `/health`.
   - Set the env vars below. The first deploy will build the API + SPA in one image. `DATABASE_URL` should point at the Supabase project so you only pay for one DB.

### Env vars (Railway, single set)

```
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
APP_BASE_URL=${{RAILWAY_PUBLIC_DOMAIN}}
WEB_ORIGIN=${{RAILWAY_PUBLIC_DOMAIN}}
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<REF>.supabase.co:5432/postgres
SESSION_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
LOG_LEVEL=info
RATE_LIMIT_DEFAULT_MAX=300
RATE_LIMIT_DEFAULT_WINDOW=1 minute
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_AUTH_WINDOW=1 minute
```

`APP_BASE_URL` and `WEB_ORIGIN` use Railway's `${{RAILWAY_PUBLIC_DOMAIN}}` template, so the API always knows its own public URL. No CORS or cookie pain because everything is same-origin.

### One-time bootstrap after first deploy

```bash
# Apply migrations against the Supabase DB.
DATABASE_URL=<supabase url> pnpm --filter=@departify-crm/db migrate

# Seed the demo organization (optional, only for trying it out).
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
