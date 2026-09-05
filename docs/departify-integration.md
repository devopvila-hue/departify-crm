# DEPARTIFY ↔ CRM integration

This document is the **scaffold** of the integration contract.
A full, executable version lands in Phase 8 with the Customer Zero
end-to-end run.

## Goals

- DEPARTIFY can create, read, update and delete every business
  resource in the CRM on behalf of a customer organization.
- DEPARTIFY never holds a human user password.
- Every DEPARTIFY call is scoped to a single CRM organization.
- Every write is auditable and idempotent.

## Organization mapping

The CRM carries an optional `external_id` on `organizations`. DEPARTIFY
uses this to map its own `organizationId` to the CRM org:

1. On first contact, DEPARTIFY calls
   `POST /api/v1/organizations/external-map` (TBD in Phase 8) with
   `{ externalId: '<departify-org-id>', name }`. The CRM creates a
   new org and returns `{ id, externalId }`.
2. Alternatively, an admin in the CRM can call
   `POST /api/v1/auth/onboard-external` (already implemented) to set
   `external_id` on their org.

Going forward, DEPARTIFY uses the CRM `id` (or the `external_id`)
when issuing requests.

## Authentication

DEPARTIFY authenticates with a **service API key** rather than a
session. The org admin in the CRM creates a key from
**Settings → Integraciones**. The plaintext secret is shown exactly
once. The key is sent as `Authorization: Bearer <secret>`.

```http
GET /api/v1/contacts HTTP/1.1
Host: crm.departify.app
Authorization: Bearer dep_ak_live_4g7z...
Cookie: (none)
```

The API attaches a tenant context with `actorKind: 'service'`. All
queries are scoped to the org that owns the key. Role checks
(`requireRole('admin')`) are bypassed for service actors; the
contract is the API key, not the user role. Per-scope enforcement
arrives in Phase 8 alongside the customer zero scenario.

## Endpoints used by DEPARTIFY

The full OpenAPI document is at `/openapi.json`. The current sprint
already covers the surface DEPARTIFY needs to:

| Capability                   | Endpoint                                |
| ---------------------------- | --------------------------------------- |
| Create / update a contact    | `POST /api/v1/contacts`, `PATCH .../:id` |
| Create / update a company    | `POST /api/v1/companies`, `PATCH .../:id` |
| Create / move a deal         | `POST /api/v1/deals`, `POST .../move`   |
| Tag entities                 | `POST /api/v1/tags/assign`              |
| List with filters            | `GET /api/v1/contacts?filter=...`       |
| Read what needs attention    | `GET /api/v1/attention`                 |
| Global search                | `GET /api/v1/search?q=...`              |

In Phase 5+ DEPARTIFY will additionally use:

| Capability                   | Endpoint                                |
| ---------------------------- | --------------------------------------- |
| Create / enroll sequence     | `POST /api/v1/sequences`, `POST .../enroll` |
| Configure sender             | `POST /api/v1/email-senders`            |
| Create template              | `POST /api/v1/email-templates`          |
| Read sequence analytics      | `GET /api/v1/sequences/:id/analytics`   |
| Listen for events            | Webhooks (Phase 6)                      |

## Idempotency

POSTs that should be safe to retry accept an optional
`Idempotency-Key` header. The server stores
`sha256(actorOrg + route + key)` for 24 hours and replays the
original response on collision. This is the recommended path for
DEPARTIFY's batch jobs.

## Pagination

All list endpoints accept `page` and `pageSize` (default 25, max 200)
and return:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "total": 0,
  "totalPages": 1
}
```

## Error contract

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid body",
  "details": { "issues": { "email": ["Invalid email"] } },
  "correlationId": "req_01H..."
}
```

`code` is one of the stable strings in
`packages/shared/src/errors.ts`. DEPARTIFY must branch on `code`, not
on `message`. Every response carries a `correlationId` for support
lookups.

## Customer Zero (Phase 8)

The integration is considered done when this script runs end-to-end
**without any real email being sent**:

1. Create / fetch org A.
2. Bulk-upsert 50 companies in `España` (selected industries).
3. Bulk-upsert 50 contacts tagged `prospect`.
4. Create one dynamic list matching those contacts.
5. Configure a `fake` email sender (so no real email is sent).
6. Create a template and a sequence.
7. Enroll the list.
8. Trigger the sequence worker.
9. Read `message_events` and confirm the timeline reflects each step.
10. Read `/api/v1/attention` and confirm counts are coherent.

This script lives in `scripts/customer-zero.ts` (Phase 8).

## Next steps for DEPARTIFY

- **Sprint 2 of the CRM** ships the email provider contract and
  the fake provider. DEPARTIFY's outreach pipeline can then call
  the CRM's `POST /api/v1/email-senders` with a `fake` provider in
  dev and Resend / Brevo in production.
- **Sprint 3 of the CRM** ships the sequence engine. DEPARTIFY
  stops storing sequence state in its own DB and instead
  `POST`s to `/api/v1/sequences/...` and lets the CRM scheduler
  own timing, retries, suppression and unsubscribe.
- **Sprint 4 of the CRM** ships the full Phase 8 contract, the
  webhook surface, and the Customer Zero simulation script.
