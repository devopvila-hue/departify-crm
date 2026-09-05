# Architecture

## Principles

- **One source of truth per concept.** `organization_id` is on every
  business table. `tenant context` is the only way routes access the
  database. The frontend never filters; it only displays what the
  server returned.
- **No premature distribution.** Single Fastify process per service.
  Background work is implemented as a separate `worker.ts` process
  that shares the same code and DB connection. No Redis unless a
  concrete workload requires it; the sequence engine will start
  PostgreSQL-based and only escalate if benchmarks demand it.
- **Provider neutrality for email.** All email is sent through an
  `EmailProvider` interface. Resend and Brevo are first-class
  implementations; a `fake` provider is used in dev and tests so no
  developer can accidentally send real email.
- **No LLMs inside the CRM.** The CRM is deterministic. Any
  intelligent behaviour (lead discovery, copy generation, etc.)
  lives in DEPARTIFY and is driven through the CRM API.

## Module map

```
apps/api/src/
  config.ts                 Env validation (Zod)
  errors.ts                 ApiError class + sendError handler
  lib/
    crypto.ts               AES-256-GCM, SHA-256, token helpers
    filter.ts               FilterNode → SQL translator
  tenants/
    context.ts              TenantContext type
    plugin.ts               Auth + tenant attach, requireAuth, requireRole
  audit/
    log.ts                  audit()
  activities/
    log.ts                  recordActivity()
  modules/
    auth/                   signup, login, logout, me, external-id mapping
    contacts/               CRUD, list with search+filter, timeline
    companies/              CRUD, list with search+filter
    pipelines/              CRUD, kanban, ensure-default
    deals/                  CRUD, move, list
    tags/                   CRUD, bulk assign
    notes/                  CRUD attached to subject
    tasks/                  CRUD with overdue filter
    custom-fields/          Defs CRUD (organization-scoped)
    search/                 Global search over contacts+companies+deals
    attention/              /attention — operational home data
    service-keys/           API key management (DEPARTIFY integration)
    health/                 /health, /ready
  openapi/                  Programmatic OpenAPI builder
  server.ts                 buildApp() — composition root
  index.ts                  Boot
```

## Multi-tenancy

`tenants/plugin.ts` registers a global preHandler that, on every
request:

1. Checks for a `Bearer` token in `Authorization`. If present, looks it
   up in `api_keys` (SHA-256 hash) and attaches a tenant context with
   `actorKind: 'service'`.
2. Else, looks for a `sid` cookie or `Session <token>` header. If
   present, validates the session against the `sessions` table and
   joins `memberships` to attach a tenant context with
   `actorKind: 'user'` and the user's role.
3. If neither is present, leaves `req.tenant` undefined. Open routes
   (login, signup, health) proceed; protected routes use
   `preHandler: [requireAuth]` which throws 401.

Every business route adds a per-route preHandler that asserts
`req.tenant` is set and then uses `req.tenant.db` (a per-request Drizzle
instance) for queries. Every WHERE clause starts with
`eq(table.organizationId, tenant.organizationId)`. There is no path
through the codebase that bypasses this.

## Encryption

- Passwords: Argon2id (memory=64MB, time=3, parallelism=4).
- Session token: 32 random bytes, base64url. Stored as SHA-256 hash
  in `sessions.token_hash`.
- API keys: 40 random bytes, base64url. Stored as SHA-256 hash in
  `api_keys.token_hash`. Plaintext is returned **only** at creation.
- Email provider credentials (Phase 5+): AES-256-GCM envelope
  encryption with a key derived from `ENCRYPTION_KEY`. Stored as
  base64 in `email_senders.credentials_encrypted`. Decrypted only
  inside the provider adapter, never in route handlers, never logged,
  never returned to the client.

## Observability

- `request.id` (Fastify built-in) is used as the correlation id.
- `ApiError` always carries a `correlationId` in its body.
- Structured logging via Pino. Pretty-printed in dev, JSON in prod.
- `audit_events` row is written on every meaningful mutation. The
  `correlation_id` column lets ops trace a request across logs and
  the audit ledger.

## Sequence engine (planned, Phase 6)

Single shared worker process. Reads due enrollments with:

```sql
SELECT * FROM sequence_enrollments
WHERE status = 'active' AND next_action_at <= now()
ORDER BY next_action_at
LIMIT 50
FOR UPDATE SKIP LOCKED;
```

For each enrollment, advances the step, dispatches to the email
provider, and writes a `message_events` row. Idempotency: each
enrollment step has at most one `message_events` row of kind `sent`
or `failed`, and we re-check inside the same transaction. The worker
is restart-safe because:

- `FOR UPDATE SKIP LOCKED` prevents two workers claiming the same row.
- A partial crash mid-send leaves the row in `active` but with a stale
  `next_action_at`. On restart, the row is picked up again and the
  provider's idempotency key (the enrollment + step) prevents a
  duplicate message.

This is sketched in the email tables; full implementation lands in
Phase 6 with end-to-end tests using the `fake` provider.
