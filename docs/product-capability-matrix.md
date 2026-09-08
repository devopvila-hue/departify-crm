# DEPARTIFY CRM — Product Capability Matrix

> Audit date: 2026-09-09 · Companion to `docs/departify-crm-saas-audit.md`.
> Goal: classify every product capability relevant to "Departify CRM as SaaS + Data/Work Core" using the SAME state + decision vocabulary across the board, so the Founder can compare at a glance.

**States**
- **EXISTING** — implemented in HEAD; behaves end-to-end.
- **PARTIAL** — implemented in some layers only (e.g. DB but not API, or API but not UI), or behaviour documented in code but not yet wired.
- **MISSING** — not implemented anywhere; only documented as a target.
- **BROKEN** — implemented but failing (currently none — see §10 of the architecture audit).
- **UNKNOWN** — outside the audited surface; needs a separate audit (e.g. real Supabase pool size, real RPS at load).

**Decisions**
- **KEEP** — do not touch.
- **ADAPT** — small surgical changes (≤ tens of LOC), no rewrite.
- **BUILD** — net-new surface (typically in Stage B Vertical 1 or later).
- **DEFER** — consciously out of scope for Vertical 1.
- **REJECT** — not appropriate for CRM Core; belongs to DEPARTIFY or OpenClaw (and not even there in some cases).

**Priority** for Vertical 1 (Stage B): `P0` = blocking; `P1` = must-have; `P2` = nice-to-have; `—` = not in Vertical 1.

---

## A. Foundation (tenancy, auth, encryption, audit, observability)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Multi-tenant data isolation | EXISTING | non-negotiable for SaaS | `tenants/plugin.ts` is the single source of truth | KEEP | — | `apps/api/src/tenants/plugin.ts`; `packages/db/src/schema/_helpers.ts` (`orgId()`); `tenant-isolation.test.ts` |
| `organization_id` on every business table | EXISTING | non-negotiable | enforced at column-definition level | KEEP | — | every schema file |
| Argon2id password hashing | EXISTING | non-negotiable | `argon2.hash(password, { type: argon2.argon2id })` | KEEP | — | `apps/api/src/modules/auth/routes.ts` |
| Cookie session for humans | EXISTING | expected UX | httpOnly + SameSite=strict in prod | KEEP | — | `apps/api/src/modules/auth/routes.ts`, `tenants/plugin.ts` |
| Bearer API key for service-to-service | EXISTING | required for DEPARTIFY integration | SHA-256 hash + scopes (jsonb) | KEEP | — | `tenants/plugin.ts`, `identity.ts`, `docs/departify-integration.md` |
| Role model (owner/admin/member) | EXISTING | RBAC foundation | enum + `requireRole(minRole)` preHandler | KEEP | — | `users.ts`, `tenants/plugin.ts` |
| Per-scope enforcement on API keys | PARTIAL | needed before DEPARTIFY batch jobs | scopes column exists; enforcement missing | BUILD | P2 | `identity.ts`, `tenants/plugin.ts` |
| Audit log (`audit_events`) | EXISTING | non-negotiable for SaaS | `audit()` helper + `correlation_id` | KEEP | — | `audit/log.ts`, `audit.ts` schema, every route |
| Correlation ID propagation | PARTIAL | needed for support across systems | present in logs + audit_events; **not yet** in MCP responses | ADAPT | P1 | `audit/log.ts`, `mcp/server.ts` (missing) |
| Encryption at rest for email provider credentials | EXISTING | required for Resend/Brevo/SMTP | AES-256-GCM envelope, decrypted only in adapter | KEEP | — | `lib/crypto.ts`, `email.ts` schema |
| Webhook HMAC verification (inbound) | EXISTING | required for Resend/Brevo | raw body preserved by custom content-type parser | KEEP | — | `server.ts` (`addContentTypeParser`), `email/routes.ts` |
| Outgoing webhook events (CRM → DEPARTIFY) | MISSING | required for Customer Zero | no surface yet | BUILD | P2 (after Vertical 1) | `docs/departify-integration.md` (target, no impl) |
| `request.id` (Fastify) | EXISTING | needed for tracing | auto-generated per request | KEEP | — | Fastify built-in |
| Structured logging via Pino (JSON prod, pretty dev) | EXISTING | operational | `server.ts` config block | KEEP | — | `server.ts` |
| OpenAPI 3.1 generated from routes | EXISTING | needed for DEPARTIFY and third parties | `openapi/index.ts` walks `app.printRoutes()` | KEEP | — | `openapi/index.ts`, `/openapi.json`, `/docs` |
| Per-route OpenAPI schemas (params, body, responses) | PARTIAL | needed for quality tool generation | only generic `summary` per route | ADAPT | P1 | `openapi/index.ts` |
| `Idempotency-Key` middleware | MISSING | required for DEPARTIFY batch jobs | documented in integration doc, not implemented | BUILD | P2 (after Vertical 1) | `docs/departify-integration.md` |
| Rate limit per API key | PARTIAL | DEPARTIFY batch jobs share IPs | current limit is per IP | BUILD | P2 | `server.ts` |
| API key management UI | EXISTING | admin onboarding | `IntegrationsPage` (`/settings/keys`) | KEEP | — | `apps/web/src/router.tsx`, `service-keys/routes.ts` |
| Multi-org user (switch active workspace) | MISSING | common SaaS feature | `users` + `memberships` allow multiple rows per user | BUILD | P2 (after Vertical 1) | `users.ts` |

---

## B. People (contacts)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Contact CRUD | EXISTING | core CRM | REST + MCP tools | KEEP | — | `contacts/routes.ts`, `contacts.ts` schema |
| Contact list (paginated + filterable + sortable) | EXISTING | core CRM | REST `/contacts?page=&pageSize=&sort=&order=&filter=` | KEEP | — | `contacts/routes.ts`, `filter.ts` |
| Contact search (global) | EXISTING | expected UX | `GET /api/v1/search` | KEEP | — | `search/routes.ts` |
| Contact lifecycle (lead/prospect/customer/partner/archived) | EXISTING | segmentation | enum + indexed | KEEP | — | `contacts.ts` schema |
| Per-org email uniqueness | EXISTING | dedupe | partial unique index | KEEP | — | `contacts.ts` schema (UNIQUE WHERE email IS NOT NULL) |
| Case-insensitive email | EXISTING | matches user expectation | `citext` custom type | KEEP | — | `_helpers.ts`, `contacts.ts` |
| `custom_values` jsonb per contact | EXISTING | extension | jsonb + `custom_field_definitions` enum-driven validation | KEEP | — | `contacts.ts`, `custom-fields.ts` |
| Contact ↔ Company relationship | EXISTING | expected | `contacts.company_id` (no FK constraint — see Risks) | ADAPT | P2 | `contacts.ts` schema |
| Contact ↔ Deal relationship | EXISTING | expected | `deal_contacts` M2M with role | KEEP | — | `deals.ts` schema |
| Public contact card `/c/:slug` + vCard | EXISTING | growth lever | opt-in via `public_slug`; partial unique index | KEEP | — | `public-card/routes.ts`, `contacts.ts` |
| Activity timeline per contact | EXISTING | relationship memory | `activities` polymorphic + `(subject_type, subject_id, created_at)` index | KEEP | — | `activities.ts` schema, `activities/log.ts` |
| Email history per contact (via message_events) | EXISTING | conversation memory | `message_events(contact_id, created_at)` index | KEEP | — | `email.ts` schema |
| Contact merging (dedupe workflow) | MISSING | common admin pain | no table or route | BUILD | P2 (after Vertical 1) | not in repo |
| Contact import (bulk CSV) | PARTIAL | onboarding | `feat/smart-csv-import` branch in `/tmp/csv-work` has it; **not merged into `main`** | BUILD (merge + harden) | P2 (after Vertical 1) | `packages/db/migrations/0003_smart_csv_import.sql` exists in branch, not in main |
| Contact enrichment (AI) | PARTIAL | nice-to-have | MCP tool `ai_enrich_contact` exists; fails with `LLM_NOT_CONFIGURED` | DEFER | P2 | `mcp/tools/ai.ts` |

---

## C. Companies

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Company CRUD | EXISTING | core CRM | REST + MCP | KEEP | — | `companies/routes.ts`, `companies.ts` schema |
| Company list (paginated + filterable + sortable) | EXISTING | core CRM | REST | KEEP | — | `companies/routes.ts` |
| Per-org domain uniqueness | EXISTING | dedupe | partial unique index | KEEP | — | `companies.ts` |
| Company status (active/inactive/archived) | EXISTING | lifecycle | enum | KEEP | — | `companies.ts` |
| `custom_values` jsonb per company | EXISTING | extension | jsonb | KEEP | — | `companies.ts`, `custom-fields.ts` |
| Company ↔ Contacts (implicit via contact.company_id) | EXISTING | relationships | single-direction FK | KEEP | — | `contacts.ts` |
| Company ↔ Deals (implicit via deal.company_id) | EXISTING | relationships | single-direction FK | KEEP | — | `deals.ts` |
| Company ↔ Tags | EXISTING | segmentation | `company_tags` PK | KEEP | — | `tags.ts` |
| Company ↔ Notes | EXISTING | collaboration | `notes(subject_type='company')` | KEEP | — | `notes.ts` |
| Company ↔ Tasks | EXISTING | work assignment | `tasks(subject_type='company')` | KEEP | — | `tasks.ts` |
| Activity timeline per company | EXISTING | relationship memory | polymorphic activities | KEEP | — | `activities.ts`, `activities/log.ts` |
| **Company record overlay** (identity + relationships + activity) | PARTIAL | **Vertical 1 target** | DB ready; UI exists (`CompanyDetailPage`) but is the existing simple detail, not an overlay | BUILD | **P0 (Vertical 1)** | `router.tsx`, `pages/companies/CompanyDetailPage.tsx` |
| **Companies table UI** with loading/empty/data/error/search/sort | PARTIAL | **Vertical 1 target** | DB + API ready; UI exists as `CompaniesPage`; needs the four states formally covered | ADAPT | **P0 (Vertical 1)** | `pages/companies/CompaniesPage.tsx` |

---

## D. Deals (pipeline + stages + value + probability)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Pipeline + Stage CRUD | EXISTING | core CRM | REST + MCP | KEEP | — | `pipelines/routes.ts`, `pipelines.ts` schema |
| Stage flags (`is_won`/`is_lost`) | EXISTING | automates status changes | boolean cols on `stages` | KEEP | — | `pipelines.ts`, `deals/routes.ts` (`POST /deals/:id/move` transaction) |
| Default probability per stage | EXISTING | forecasting UX | `stages.default_probability` | KEEP | — | `pipelines.ts`, `deals.ts` |
| Kanban view | EXISTING | sales UX | `GET /api/v1/pipelines/:id/kanban` | KEEP | — | `pipelines/routes.ts`, `pages/pipelines/PipelinePage.tsx` |
| Deal CRUD | EXISTING | core CRM | REST + MCP | KEEP | — | `deals/routes.ts`, `deals.ts` schema |
| Deal value (`valueMinor` bigint, mode:'number') | EXISTING | forecasting | stored in minor units to avoid float drift | KEEP | — | `deals.ts`, `deals/routes.ts` (`Math.round(value * 100)`) |
| Deal move between stages | EXISTING | core CRM | `POST /deals/:id/move` inside a transaction; auto-sets `status`/`won_at`/`lost_at`/`closed_at` based on stage flags | KEEP | — | `deals/routes.ts` |
| `audit('update','deal_stage')` + `recordActivity('status_change')` on move | EXISTING | audit + UX | wired in the route handler | KEEP | — | `deals/routes.ts` |
| Deal ↔ Contact (M2M) | EXISTING | stakeholder visibility | `deal_contacts` PK (deal_id, contact_id), `role` free-form | KEEP | — | `deals.ts` schema |
| Deal forecast (sum by stage × probability) | PARTIAL | expected | DB + math are there; UI is implicit | ADAPT | P2 | derived from `deals.ts`, no `forecast/routes.ts` |
| Deal ↔ Tasks | EXISTING | work assignment | `tasks(subject_type='deal')` | KEEP | — | `tasks.ts` |
| Deal win/loss reason | MISSING | analytics | no `won_reason`/`lost_reason` columns | BUILD | P2 (after Vertical 1) | `deals.ts` |
| Multi-currency roll-up | MISSING | international sales | `currency` is per-deal; no FX | BUILD | P2 (after Vertical 1) | `deals.ts` |
| Forecast accuracy tracking | MISSING | sales ops | no `forecast_snapshots` | DEFER | P2 | not in repo |

---

## E. Activities (timeline)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Activity recording (9 types) | EXISTING | core CRM | `recordActivity()` + polymorphic `(subject_type, subject_id, created_at)` index | KEEP | — | `activities.ts`, `activities/log.ts` |
| Activity feed per Company | EXISTING | relationship memory | `GET /api/v1/activities?subjectType=company&subjectId=…` (filter by subject + ordering by created_at desc) | KEEP | — | `contacts/routes.ts` (timeline endpoint pattern), `activities.ts` |
| Activity feed per Contact | EXISTING | relationship memory | same shape | KEEP | — | `contacts/routes.ts` |
| Activity feed per Deal | EXISTING | relationship memory | same shape | KEEP | — | `deals/routes.ts` |
| **Activity timeline UI** in Company overlay | PARTIAL | **Vertical 1 target** | DB + API ready; UI wiring is the deliverable | BUILD | **P0 (Vertical 1)** | `pages/companies/CompanyDetailPage.tsx` |
| Inbox / global activity feed | MISSING | daily-driver UX | no `/api/v1/inbox` route | BUILD | P2 (after Vertical 1) | not in repo |
| Comment replies on activity | MISSING | collaboration | no parent_id/self-referential FK | DEFER | P2 | not in repo |

---

## F. Tasks

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Task CRUD | EXISTING | core CRM | REST + MCP | KEEP | — | `tasks/routes.ts`, `tasks.ts` |
| Task priority (low/normal/high/urgent) | EXISTING | triage | enum | KEEP | — | `tasks.ts` |
| Task due date + overdue filter | EXISTING | attention surface | `GET /api/v1/tasks?overdue=true` + `(org, due_at)` index | KEEP | — | `tasks.ts`, `tasks/routes.ts` |
| Task status (open/done/cancelled) | EXISTING | workflow | enum + `completed_at` | KEEP | — | `tasks.ts` |
| Task ↔ Contact / Company / Deal | EXISTING | work assignment | `tasks(subject_type, subject_id)` | KEEP | — | `tasks.ts` |
| **Create task from Company overlay** | PARTIAL | **Vertical 1 target** | DB + API ready; UI in overlay is the deliverable | BUILD | **P0 (Vertical 1)** | `tasks.ts`, `tasks/routes.ts` |
| Recurring tasks | MISSING | operational | no `recurrence_rule` | DEFER | P2 | not in repo |
| Task templates | MISSING | efficiency | no `task_templates` | DEFER | P2 | not in repo |
| Bulk complete / assign | MISSING | efficiency | not in REST | DEFER | P2 | not in repo |

---

## G. Notes

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Note CRUD | EXISTING | core CRM | REST + MCP | KEEP | — | `notes/routes.ts`, `notes.ts` |
| Note attached to contact / company / deal | EXISTING | relationships | `notes(subject_type, subject_id)` | KEEP | — | `notes.ts` |
| Markdown body | EXISTING | rich content | rendered safely client-side per docs | KEEP | — | `notes.ts`, `notes/routes.ts` |
| Author nullable (system notes) | EXISTING | system events | `author_id` nullable | KEEP | — | `notes.ts` |
| Note mentions (@user) | MISSING | collaboration | no `mentions` table | DEFER | P2 | not in repo |
| Note replies / threads | MISSING | collaboration | no parent_id | DEFER | P2 | not in repo |

---

## H. Tags

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Tag CRUD | EXISTING | segmentation | REST + MCP | KEEP | — | `tags/routes.ts`, `tags.ts` |
| Tag assign / unassign (bulk) | EXISTING | efficiency | `POST /api/v1/tags/assign` | KEEP | — | `tags/routes.ts` |
| Tag ↔ Contact / Company / Deal | EXISTING | segmentation | 3 join tables, PK per pair | KEEP | — | `tags.ts` |
| Tag colours | EXISTING | UX | `tags.color` text | KEEP | — | `tags.ts` |
| Tag hierarchies / smart tags | MISSING | segmentation | not modeled | DEFER | P2 | not in repo |

---

## I. Custom fields (extension mechanism)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Definition CRUD | EXISTING | extension | `custom_field_definitions` + 10-type enum | KEEP | — | `custom-fields/routes.ts`, `custom-fields.ts` |
| 10 value types (text/textarea/number/boolean/date/datetime/select/multi_select/url/email) | EXISTING | coverage | enum | KEEP | — | `custom-fields.ts` |
| Per-org (entity, key) uniqueness | EXISTING | correctness | partial unique | KEEP | — | `custom-fields.ts` |
| Values ride on `custom_values jsonb` of the parent record | EXISTING | simpler joins | no separate `custom_field_values` table | KEEP | — | every object schema |
| "Record" + "Relationship" types | MISSING | future | no junction table yet | BUILD | P2 (after Vertical 1) | `custom-fields.ts` (not in enum) |
| Formula, Rating, Status, Timestamp, User, Interaction, Domain types | MISSING | future | not in current 10 | DEFER | P2 | brief §9 |
| Per-type constraints at DB layer | MISSING | correctness | validation is Zod-only today | DEFER | P2 | every route |

---

## J. Lists / views

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Static list (M2M) | PARTIAL | segmentation | `lists` + `list_contacts` exist in `identity.ts`; no REST endpoints visible | BUILD (or KEEP the schema and build endpoints later) | P2 (after Vertical 1) | `identity.ts` |
| Dynamic list (FilterNode) | PARTIAL | segmentation | schema has `definition jsonb`; `filter.ts` has the FilterNode→SQL translator | BUILD (wire up REST) | P2 (after Vertical 1) | `filter.ts`, `identity.ts` |
| View persistence (per workspace, per object, per user) | MISSING | expected for SaaS | no `views` table | BUILD | P2 (after Vertical 1) | not in repo |
| Kanban view for Companies (in addition to Deals) | MISSING | optional | no view definition table | DEFER | P2 | not in repo |
| Table + Kanban + Timeline visualisations | PARTIAL | expected | Kanban exists for Deals; Companies has a table | ADAPT | P2 | `pages/pipelines/PipelinePage.tsx` |

---

## K. Email / sequences (Sprint 5)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Email sender CRUD (resend/brevo/smtp/fake) | EXISTING | operational | REST + `email_senders` | KEEP | — | `email/routes.ts`, `email.ts` |
| Encrypted credentials at rest | EXISTING | security | AES-256-GCM envelope | KEEP | — | `lib/crypto.ts`, `email.ts` |
| Email template CRUD (subject + body + html) | EXISTING | content | REST + `email_templates` | KEEP | — | `email/routes.ts`, `email.ts` |
| Sequence CRUD with typed steps | EXISTING | automation | REST + `sequences.steps` jsonb with typed shape | KEEP | — | `email/routes.ts`, `email.ts` |
| Sending window + timezone | EXISTING | operational | `sequences(timezone, sending_window_start, sending_window_end)` | KEEP | — | `email.ts` |
| Enroll contact (or list) into sequence | EXISTING | activation | REST + `sequenceEnrollments` | KEEP | — | `email/routes.ts`, `email.ts` |
| Sequence worker (in-process, `FOR UPDATE SKIP LOCKED`) | EXISTING | scheduling | `email/worker.ts`; comment already says "real deploy with multiple replicas you'd run it as a separate service via `pnpm worker`" | KEEP (separate-process move is Stage B hardening) | — | `email/worker.ts` |
| Idempotency per (enrollment, step) | EXISTING | correctness | inside the transaction | KEEP | — | `email/worker.ts` |
| Suppressions (unsubscribed/hard_bounce/complaint/manual/invalid) | EXISTING | compliance | `suppressions` per-org unique | KEEP | — | `email/routes.ts`, `email.ts` |
| Public unsubscribe (`/api/v1/public/unsubscribe` token-based) | EXISTING | compliance | route exists | KEEP | — | `email/routes.ts` |
| Webhooks inbound (`/api/v1/webhooks/...`) | EXISTING | provider events | HMAC-verified | KEEP | — | `email/routes.ts`, `email/tracking.ts` |
| Message events ledger (`queued/sent/delivered/bounced/...`) | EXISTING | observability | `message_events` with 9 enum kinds | KEEP | — | `email.ts`, `email/routes.ts` |
| Tracking pixel + click redirect | EXISTING | analytics | `/api/v1/tracking/...` | KEEP | — | `email/tracking.ts`, `email/trackingRoutes.ts` |
| Bounce handling + automatic suppression | PARTIAL | compliance | webhook writes to `message_events`; suppression is manual today | ADAPT | P2 | `email/routes.ts` |
| Stop-on-reply | PARTIAL | operational | conditional step exists; reply detection wiring is manual | ADAPT | P2 | `email.ts` (`ifEvent: 'replied'`) |
| Sequence analytics UI | MISSING | ops UX | no `/api/v1/sequences/:id/analytics` UI yet | BUILD | P2 (after Vertical 1) | `docs/departify-integration.md` (target) |
| Send-as-user (delegation) | MISSING | B2B sales | no model | DEFER | P2 | not in repo |

---

## L. LLM / AI

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| LLM client abstraction | EXISTING | vendor-neutral | `packages/llm/src/factory.ts` | KEEP | — | `factory.ts` |
| Anthropic-compatible provider (works with MiniMax via baseUrl) | EXISTING | works with local model policy | `anthropic.ts` | KEEP | — | `anthropic.ts` |
| `openai` provider | PARTIAL | future | factory throws `not implemented` | DEFER | P2 | `factory.ts` |
| LLM proxy routes (`/api/v1/llm`, `/api/v1/ai`) | EXISTING | server-side calls | `llm/routes.ts`, `ai/routes.ts` | KEEP | — | routes |
| MCP AI tools (`ai_enrich_contact`, `ai_score_contact`, `ai_deal_risks`, `ai_draft_reply`, `ai_summarize_contact`, `ai_extract_contact`, `ai_build_list`, `ai_status`) | EXISTING | nice-to-have | registered; return `LLM_NOT_CONFIGURED` until key is set | KEEP (gated by env) | — | `mcp/tools/ai.ts` |
| AI public card (`/c/:slug/ai`) | PARTIAL | growth lever | `ai-tracking-card.test.ts` exists | KEEP | — | test file |
| Persistent inference storage (provider, prompt version, timestamp, actor, source, confidence) | MISSING | required by the brief §15 but not for Stage B | not in CRM | DEFER | P2 (after Vertical 1) | not in repo |
| Ask Departify (BOS-level) | DEFER to DEPARTIFY | — | — | REJECT (lives in DEPARTIFY, not CRM) | — | brief §15 |

---

## M. Search

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Global search (contacts/companies/deals) | EXISTING | daily driver | `search/routes.ts` | KEEP | — | `search/routes.ts` |
| Per-org scoped | EXISTING | tenancy | tenant preHandler | KEEP | — | `tenants/plugin.ts` |
| Ranking / relevance | PARTIAL | quality | basic; no BM25 or tsvector | ADAPT | P2 | `search/routes.ts` |
| Search across activities / notes / tasks | MISSING | power-user | no surface | DEFER | P2 | not in repo |

---

## N. Apps / connections

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Email providers (Resend/Brevo/SMTP/fake) | EXISTING | first-party | `email/providers.ts` | KEEP | — | `email/providers.ts`, `email/routes.ts` |
| Calendar / contacts / files apps (Gmail, Microsoft, Slack, Google Drive, Calendly, GitHub, Vercel, Supabase, Stripe, WhatsApp, Meta) | MISSING | SaaS breadth | no App registry / Connection model | BUILD (after Vertical 1) | P2 (post-Vertical 1) | not in repo |
| App manifest contract (id, name, provider, version, category, auth, scopes, capabilities, entitlements, health) | MISSING | extension contract | not modeled | BUILD (after Vertical 1) | P2 (post-Vertical 1) | brief §14 |
| Connection health check | MISSING | operational | not modeled | BUILD (after Vertical 1) | P2 | not in repo |
| Connection scopes per execution | PARTIAL | safety | `api_keys.scopes` exists; Connection-level scopes not modeled | DEFER | P2 | `identity.ts` |

---

## O. Workflows

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Email sequence engine | EXISTING (in-process) | first workflow | `email/worker.ts` | KEEP | — | `email/worker.ts` |
| Generic workflow engine (trigger, conditions, branches, actions, retries, idempotency, draft/publish/pause, run history, manual replay) | MISSING | power-user | not modeled | BUILD (later, after Vertical 1) | P2 | brief §16 |
| Workflow execution audit | PARTIAL | ops | `audit_events` covers it | KEEP | — | `audit.ts` |

---

## P. Departments (manifest contract)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| `DepartmentManifest` typed contract | MISSING | extension contract | not modeled | BUILD (after Vertical 1) | P2 (post-Vertical 1) | brief §12 |
| VENTAS department (People, Companies, Deals, pipeline, activities, follow-up, sequences, forecast) | PARTIAL | covers Ventas today via REST + MCP | existing surfaces | KEEP + ADAPT for forecast | — | every module + MCP |
| MARKETING / SEO / SUPPORT / ADMIN / DEVELOPER / DIRECCIÓN | MISSING | roadmap | not modeled | BUILD (post-Vertical 1) | P2 | brief §13 |
| Department extension over CRM Core (no duplicated business data) | N/A | core principle | — | KEEP (principle) | — | brief principle |

---

## Q. App shell (UX)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| **App shell** (sidebar persistent desktop, collapsible tablet, drawer mobile) | PARTIAL | **Vertical 1 target** | `AppLayout` exists; needs the shell semantics per brief §18 | BUILD | **P0 (Vertical 1)** | `components/layout/AppLayout.tsx` |
| **Command palette** (cmdk) | MISSING | daily driver | not implemented | BUILD | **P0 (Vertical 1)** | brief §20 |
| Search / Command Palette routing | PARTIAL | UX | `GET /api/v1/search` ready; no UI hook yet | BUILD | **P0 (Vertical 1)** | `search/routes.ts` |
| Inbox (global activity) | MISSING | daily driver | not implemented | BUILD | P2 | not in repo |
| Workspace selector | MISSING | multi-org | not implemented (multi-org user) | BUILD | P2 | brief §19 |
| Getting Started | MISSING | onboarding | not implemented | BUILD | P2 | not in repo |
| Plan / Usage | MISSING | monetisation | entitlements not modeled | BUILD (after billing) | P2 | brief §19 |
| Profile / Settings | MISSING | UX | auth has `/auth/me`; no profile UI yet | BUILD | P2 | not in repo |

---

## R. Identity (future SSO)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Email + password | EXISTING | baseline | argon2id | KEEP | — | `modules/auth/routes.ts` |
| Invitations | PARTIAL | team onboarding | `memberships.status='invited'` exists; no `/auth/invite` endpoint | BUILD | P2 | `users.ts` |
| Teams / Roles | PARTIAL | scaling | `membership_role` exists; no `teams` table | BUILD | P2 | brief §4 |
| Google SSO | MISSING | enterprise | not modeled | DEFER | P2 (after billing) | brief §5 |
| Microsoft SSO | MISSING | enterprise | not modeled | DEFER | P2 | brief §5 |
| Service accounts / API keys | EXISTING | DEPARTIFY integration | `api_keys` | KEEP | — | `identity.ts` |

---

## S. Public surface

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| Public contact card `/c/:slug` | EXISTING | growth | opt-in via `contacts.public_slug` | KEEP | — | `public-card/routes.ts` |
| Public contact card vCard export | EXISTING | growth | `publicCardVCardRoute` | KEEP | — | `public-card/routes.ts` |
| Public unsubscribe (`/api/v1/public/unsubscribe`) | EXISTING | compliance | token-based | KEEP | — | `email/routes.ts` |
| Public tracking pixel | EXISTING | analytics | `/api/v1/tracking/...` | KEEP | — | `email/trackingRoutes.ts` |
| Public API (no auth) for landing pages / docs | N/A | — | — | REJECT (CRM is internal-only, not a marketing site) | — | brief §6 |

---

## T. Entitlements / billing (SaaS commercial)

| Capability | Current state | Business value | Architectural fit | Decision | Priority | Evidence |
|---|---|---|---|---|---|---|
| `EntitlementService.can(workspace, user, capability)` contract | MISSING | monetisation | not modeled | BUILD (after Vertical 1) | P2 | brief §5 |
| Plan / trial / seats / usage / add-ons / invoices / payment method | MISSING | monetisation | not modeled | BUILD (after Vertical 1) | P2 | brief §6 |
| Idempotent provisioning (`organization → workspace → owner → base entitlements → base objects → base views → preferences → getting started → audit event`) | PARTIAL | onboarding | signup creates org + user + owner membership; entitlements, base views, getting started NOT yet | BUILD (after Vertical 1) | P2 | `modules/auth/routes.ts` |
| Stripe integration | DEFER | monetisation | explicit brief exclusion ("NO integres Stripe ni modifiques billing real durante esta misión inicial") | DEFER | P2 | brief §6 |

---

## U. Documentation (this audit)

| Capability | Current state | Business value | Decision | Priority | Evidence |
|---|---|---|---|---|---|
| README.md | EXISTING | onboarding | KEEP | — | `README.md` |
| `docs/architecture.md` | EXISTING | reference | KEEP | — | `docs/architecture.md` |
| `docs/departify-integration.md` | EXISTING | contract scaffold | KEEP | — | `docs/departify-integration.md` |
| `docs/departify-crm-saas-audit.md` (this audit) | NEW | audit | BUILD (this commit) | P0 (Stage A) | this file |
| `docs/product-capability-matrix.md` (this audit) | NEW | decision aid | BUILD (this commit) | P0 (Stage A) | this file |
| Per-module developer docs | MISSING | onboarding | BUILD | P2 (after Vertical 1) | not in repo |
| Customer Zero script (`scripts/customer-zero.ts`) | MISSING | integration proof | BUILD (Phase 8) | P2 | `docs/departify-integration.md` |

---

## V. Test coverage

| Capability | Current state | Business value | Decision | Priority | Evidence |
|---|---|---|---|---|---|
| Cross-tenant isolation | EXISTING | non-negotiable | KEEP + extend per resource | — | `tenant-isolation.test.ts` |
| Contacts + deals CRUD smoke | EXISTING | regression | KEEP | — | `contacts.test.ts` |
| MCP smoke | EXISTING | regression | KEEP | — | `mcp.test.ts` |
| Email (providers + sequence) | EXISTING | regression | KEEP | — | `email.test.ts` |
| AI tracking card | EXISTING | regression | KEEP | — | `ai-tracking-card.test.ts` |
| Real ESLint enforcement | MISSING | quality | BUILD | P2 | scripts are no-op |
| Per-resource overlay test (Company overlay + tasks + activities) | MISSING | Vertical 1 | BUILD | **P0 (Vertical 1)** | brief §26 |
| Visual / e2e test stack | MISSING | quality | DEFER | P2 | not in repo |
| Load test | MISSING | scale | DEFER | P2 | not in repo |

---

## Summary of the matrix

- **EXISTING**: the bulk of the CRM Core. Multi-tenant SaaS foundation is solid (tenancy, auth, encryption, audit, OpenAPI, sequence engine, email providers, MCP).
- **PARTIAL**: the UI side of Vertical 1 (overlay + table + states), LLM provider `openai`, webhook outgoing events, Idempotency-Key middleware, correlation_id propagation to MCP.
- **MISSING**: command palette, app shell semantics, all SSO, all apps beyond email, generic workflow engine, custom-object Record/Relationship, contact merge, deal win/loss reason, multi-currency roll-up.
- **BROKEN**: none in HEAD.

Stage B (Vertical 1) should focus on:
- 4 P0 items (Company overlay, Companies table states, Command palette, App shell)
- 3 P1 items (correlation_id in MCP, per-route OpenAPI enrichment, multi-org /auth/me)
- P2 items after Vertical 1 ships and is approved.

---

_Author: Marcos (Ventas, Departify CRM TEST). Reviewer: Founder. STOP after Stage A — no Vertical 1 implementation until explicit authorisation._
