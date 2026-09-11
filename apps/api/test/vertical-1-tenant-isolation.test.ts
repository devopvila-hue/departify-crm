/**
 * Vertical 1 — cross-tenant isolation for Companies / Contacts /
 * Deals / Tasks / Activities.
 *
 * Extends the existing tenant-isolation.test.ts pattern (spawn API in
 * beforeAll, fetch with the org-A cookie, assert 401/403/404 when
 * touching org-B resources).
 *
 * Special focus (per Founder §10):
 *   No permitir crear una Task o Activity en Tenant A apuntando
 *   mediante subjectId a Company / Person / Deal de Tenant B.
 *   Eso también es una fuga cross-tenant.
 *
 * The test inherits the setup helpers from the existing test file
 * (createOrg / authed / jsonOrThrow / beforeAll boot pattern).
 * We duplicate the helpers here on purpose so this file can be run
 * standalone; it does not depend on the order of the existing suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import argon2 from 'argon2';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm_test';

let api: TestApi | null = null;
let BASE_URL = '';
let started = false;

beforeAll(async () => {
  await resetSchema(DATABASE_URL);
  api = await startTestApi(DATABASE_URL);
  BASE_URL = api.baseUrl;
  started = true;
}, 60_000);

afterAll(async () => {
  await api?.stop();
});

interface Setup {
  cookie: string;
  orgId: string;
  userId: string;
  contactId: string;
  companyId: string;
  dealId: string;
  pipelineId: string;
  stageId: string;
}

async function createOrg(label: string): Promise<Setup> {
  const db = createDb(DATABASE_URL);
  const orgId = generateId(Prefixes.organization);
  const userId = generateId(Prefixes.user);
  const email = `v1-${label}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const passwordHash = await argon2.hash('test-password-1234', { type: argon2.argon2id });
  await db.insert(schema.organizations).values({ id: orgId, name: `V1 ${label}`, slug: `v1-${label}-${Math.random().toString(36).slice(2, 8)}` });
  await db.insert(schema.users).values({ id: userId, email, passwordHash, displayName: `V1 ${label}` });
  await db.insert(schema.memberships).values({
    id: generateId(Prefixes.membership),
    organizationId: orgId,
    userId,
    role: 'owner',
    status: 'active',
  });
  const contactId = generateId(Prefixes.contact);
  await db.insert(schema.contacts).values({ id: contactId, organizationId: orgId, fullName: `Persona ${label}`, email, lifecycle: 'lead' });
  const companyId = generateId(Prefixes.company);
  await db.insert(schema.companies).values({ id: companyId, organizationId: orgId, name: `Company ${label}`, status: 'active' });
  const pipelineId = generateId(Prefixes.pipeline);
  await db.insert(schema.pipelines).values({ id: pipelineId, organizationId: orgId, name: `Pipeline ${label}` });
  const stageId = generateId(Prefixes.stage);
  await db.insert(schema.stages).values({ id: stageId, organizationId: orgId, pipelineId, name: 'Stage 1', position: 0, defaultProbability: 10 });
  const dealId = generateId(Prefixes.deal);
  await db.insert(schema.deals).values({ id: dealId, organizationId: orgId, pipelineId, stageId, name: `Deal ${label}`, valueMinor: 100_000, currency: 'EUR', status: 'open' });

  const login = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-1234' }),
  });
  if (!login.ok) throw new Error(`login failed for ${label}: ${login.status} ${await login.text()}`);
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie) throw new Error('no session cookie returned');
  return {
    cookie: setCookie.split(';')[0]!,
    orgId,
    userId,
    contactId,
    companyId,
    dealId,
    pipelineId,
    stageId,
  };
}

function authed(cookie: string): Record<string, string> {
  return { cookie };
}

interface ActivitiesResponse {
  items: Array<{
    id: string;
    type: string;
    subjectType: string;
    subjectId: string;
    actorId: string | null;
    title: string;
    body: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

describe('Vertical 1 — cross-tenant isolation', () => {
  let a: Setup;
  let b: Setup;

  it('boots the test API', () => {
    expect(started).toBe(true);
  });

  it('org A cannot read org B company (GET /companies/:id)', async () => {
    a = await createOrg('A');
    b = await createOrg('B');
    const res = await fetch(`${BASE_URL}/api/v1/companies/${b.companyId}`, { headers: authed(a.cookie) });
    expect(res.status).toBe(404);
  });

  it('org A cannot update org B company (PATCH /companies/:id)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/companies/${b.companyId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authed(a.cookie) },
      body: JSON.stringify({ name: 'hijacked' }),
    });
    expect(res.status).toBe(404);
    // confirm org B company unchanged
    const db = createDb(DATABASE_URL);
    const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, b.companyId));
    expect(rows[0]?.name).toBe('Company B');
  });

  it('org A cannot delete org B company (DELETE /companies/:id)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/companies/${b.companyId}`, {
      method: 'DELETE',
      headers: authed(a.cookie),
    });
    expect(res.status).toBe(404);
    const db = createDb(DATABASE_URL);
    const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, b.companyId));
    expect(rows.length).toBe(1);
  });

  it('org A cannot read org B contact (GET /contacts/:id)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/contacts/${b.contactId}`, { headers: authed(a.cookie) });
    expect(res.status).toBe(404);
  });

  it('org A cannot read org B deal (GET /deals/:id)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/deals/${b.dealId}`, { headers: authed(a.cookie) });
    expect(res.status).toBe(404);
  });

  it('org A cannot update org B deal (PATCH /deals/:id)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/deals/${b.dealId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authed(a.cookie) },
      body: JSON.stringify({ value: 9_999_999 }),
    });
    expect(res.status).toBe(404);
    const db = createDb(DATABASE_URL);
    const rows = await db.select().from(schema.deals).where(eq(schema.deals.id, b.dealId));
    expect(Number(rows[0]?.valueMinor)).toBe(100_000);
  });

  // ---- Founder §10: subjectId cross-tenant attempt --------------------

  it('org A cannot create a Task pointing to org B company (subjectId cross-tenant)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(a.cookie) },
      body: JSON.stringify({
        title: 'cross-tenant attempt',
        subjectType: 'company',
        subjectId: b.companyId, // <-- org B's company
      }),
    });
    // Either 404 (target not visible) or 400 (validation rejects) is acceptable.
    // The KEY assertion is that the task does NOT exist in A pointing to B.
    expect([400, 404]).toContain(res.status);
    const db = createDb(DATABASE_URL);
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.organizationId, a.orgId));
    expect(rows.length).toBe(0);
  });

  it('org A cannot create a Task pointing to org B deal (subjectId cross-tenant)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(a.cookie) },
      body: JSON.stringify({
        title: 'cross-tenant attempt',
        subjectType: 'deal',
        subjectId: b.dealId,
      }),
    });
    expect([400, 404]).toContain(res.status);
    const db = createDb(DATABASE_URL);
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.organizationId, a.orgId));
    expect(rows.length).toBe(0);
  });

  it('org A cannot read org B activities via /api/v1/activities', async () => {
    // No activities exist for org B; this asserts the filter is enforced.
    // If the API ever returned cross-tenant activities it would be a leak.
    const res = await fetch(
      `${BASE_URL}/api/v1/activities?subjectType=company&subjectId=${b.companyId}`,
      { headers: authed(a.cookie) },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as ActivitiesResponse;
    expect(body.items.length).toBe(0);
  });

  it('org A list /contacts?companyId=<B> returns empty (not 403, not cross-tenant data)', async () => {
    const res = await fetch(
      `${BASE_URL}/api/v1/contacts?companyId=${b.companyId}`,
      { headers: authed(a.cookie) },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as ListResponse<unknown>;
    expect(body.items.length).toBe(0);
  });

  it('org A list /deals?companyId=<B> returns empty', async () => {
    const res = await fetch(
      `${BASE_URL}/api/v1/deals?companyId=${b.companyId}`,
      { headers: authed(a.cookie) },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as ListResponse<unknown>;
    expect(body.items.length).toBe(0);
  });

  it('org A list /tasks?subjectType=company&subjectId=<B> returns empty', async () => {
    const res = await fetch(
      `${BASE_URL}/api/v1/tasks?subjectType=company&subjectId=${b.companyId}`,
      { headers: authed(a.cookie) },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as ListResponse<unknown>;
    expect(body.items.length).toBe(0);
  });
});
