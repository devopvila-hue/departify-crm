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
