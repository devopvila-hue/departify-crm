/**
 * Smoke + CRUD tests for Contacts and Deals. These run against a real
 * Postgres + the running test server (see tenant-isolation.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import argon2 from 'argon2';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm_test_2';

let api: TestApi | null = null;
let BASE_URL = '';

beforeAll(async () => {
  await resetSchema(DATABASE_URL);
  api = await startTestApi(DATABASE_URL);
  BASE_URL = api.baseUrl;
}, 60_000);

afterAll(async () => {
  await api?.stop();
});

async function signupAndLogin(email: string, password: string, org: string) {
  const db = createDb(DATABASE_URL);
  const orgId = generateId(Prefixes.organization);
  const userId = generateId(Prefixes.user);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await db.insert(schema.organizations).values({ id: orgId, name: org, slug: `slug-${Math.random().toString(36).slice(2, 8)}` });
  await db.insert(schema.users).values({ id: userId, email, passwordHash, displayName: 'Test' });
  await db.insert(schema.memberships).values({
    id: generateId(Prefixes.membership),
    organizationId: orgId,
    userId,
    role: 'owner',
    status: 'active',
  });
  const login = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
  return login.headers.get('set-cookie')!.split(';')[0]!;
}

function authed(cookie: string): Record<string, string> {
  return { cookie };
}

describe('contacts CRUD', () => {
  let cookie: string;

  it('signs in', async () => {
    cookie = await signupAndLogin('owner@contacts.test', 'password-1234', 'Contacts Org');
  });

  it('creates a contact with the minimum required fields', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ fullName: 'Lucía Vidal' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^con_/);
  });

  it('rejects contact without fullName', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ email: 'broken@example.test' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('lists contacts with pagination + search', async () => {
    // Create 3 more contacts
    for (const name of ['Mateo Castro', 'Sofía Sanz', 'Lucía Martínez']) {
      await fetch(`${BASE_URL}/api/v1/contacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authed(cookie) },
        body: JSON.stringify({ fullName: name }),
      });
    }
    const res = await fetch(`${BASE_URL}/api/v1/contacts?pageSize=10&search=Lucía`, { headers: authed(cookie) });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: Array<{ fullName: string }>; total: number };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items.every((c) => c.fullName.includes('Lucía'))).toBe(true);
  });
});

describe('deals + kanban', () => {
  let cookie: string;
  let pipelineId: string;
  let stageId: string;
  let dealId: string;

  it('signs in and creates a pipeline + stage', async () => {
    cookie = await signupAndLogin('owner@deals.test', 'password-1234', 'Deals Org');
    // create pipeline via DB shortcut (no admin route required when using the same connection)
    const db = createDb(DATABASE_URL);
    const rows = await db
      .select({ orgId: schema.memberships.organizationId })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.users.email, 'owner@deals.test'))
      .limit(1);
    const org = rows[0]!.orgId;
    pipelineId = generateId(Prefixes.pipeline);
    stageId = generateId(Prefixes.stage);
    await db.insert(schema.pipelines).values({ id: pipelineId, organizationId: org, name: 'Pipeline' });
    await db.insert(schema.stages).values({
      id: stageId,
      organizationId: org,
      pipelineId,
      name: 'Open',
      position: 0,
      defaultProbability: 25,
    });
  });

  it('creates a deal and moves it through a stage', async () => {
    const create = await fetch(`${BASE_URL}/api/v1/deals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ pipelineId, stageId, name: 'Acme', value: 12500 }),
    });
    expect(create.status).toBe(201);
    dealId = ((await create.json()) as { id: string }).id;
    const move = await fetch(`${BASE_URL}/api/v1/deals/${dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ stageId }),
    });
    expect(move.ok).toBe(true);
    const got = await fetch(`${BASE_URL}/api/v1/deals/${dealId}`, { headers: authed(cookie) });
    const body = (await got.json()) as { status: string; probability: number };
    expect(body.status).toBe('open');
    expect(body.probability).toBe(25);
  });

  it('returns the kanban for the pipeline', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/pipelines/${pipelineId}/kanban`, { headers: authed(cookie) });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { stages: unknown[]; deals: Array<{ id: string }> };
    expect(body.stages.length).toBeGreaterThan(0);
    expect(body.deals.map((d) => d.id)).toContain(dealId);
  });
});
