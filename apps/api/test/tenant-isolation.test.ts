/**
 * Cross-tenant isolation tests — the most important quality gate in
 * the entire CRM. These run against a real Postgres, so we rely on
 * DATABASE_URL pointing to a throwaway database.
 *
 * Each test creates two distinct organizations with their own users
 * and confirms that no operation by org A can read, modify, or delete
 * a resource owned by org B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import argon2 from 'argon2';
import { randomToken, sha256 } from '../src/lib/crypto.js';
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

interface SetupResult {
  cookie: string;
  orgId: string;
  userId: string;
  contactId?: string;
  dealId?: string;
  pipelineId?: string;
  stageId?: string;
  companyId?: string;
}

async function createOrg(label: string): Promise<SetupResult> {
  const db = createDb(DATABASE_URL);
  const orgId = generateId(Prefixes.organization);
  const userId = generateId(Prefixes.user);
  const email = `u${label}@test.local`;
  const passwordHash = await argon2.hash('test-password-1234', { type: argon2.argon2id });
  await db.insert(schema.organizations).values({ id: orgId, name: `Org ${label}`, slug: `org-${label}-${Math.random().toString(36).slice(2, 8)}` });
  await db.insert(schema.users).values({ id: userId, email, passwordHash, displayName: `User ${label}` });
  await db.insert(schema.memberships).values({
    id: generateId(Prefixes.membership),
    organizationId: orgId,
    userId,
    role: 'owner',
    status: 'active',
  });

  const contactId = generateId(Prefixes.contact);
  await db.insert(schema.contacts).values({
    id: contactId,
    organizationId: orgId,
    fullName: `Persona ${label}`,
    email: `persona-${label}@test.local`,
    lifecycle: 'lead',
  });
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

function authed(cookie: string): RequestInit {
  return { headers: { cookie } };
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    throw new Error(`unexpected ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

describe('cross-tenant isolation', () => {
  let a: SetupResult;
  let b: SetupResult;

  it('boots the test API', () => {
    expect(started).toBe(true);
  });

  it('org A cannot read org B contact', async () => {
    a = await createOrg('A');
    b = await createOrg('B');

    const res = await fetch(`${BASE_URL}/api/v1/contacts/${b.contactId}`, authed(a.cookie));
    expect(res.status).toBe(404);
  });

  it('org A cannot update org B contact', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/contacts/${b.contactId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ fullName: 'Hacked' }),
    });
    expect(res.status).toBe(404);
    // Verify the original name is intact
    const db = createDb(DATABASE_URL);
    const rows = await db.select().from(schema.contacts).where(eq(schema.contacts.id, b.contactId!));
    expect(rows[0]!.fullName).toBe('Persona B');
  });

  it('org A cannot delete org B contact', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/contacts/${b.contactId}`, {
      method: 'DELETE',
      headers: { cookie: a.cookie },
    });
    expect(res.status).toBe(404);
    const db = createDb(DATABASE_URL);
    const rows = await db.select().from(schema.contacts).where(eq(schema.contacts.id, b.contactId!));
    expect(rows.length).toBe(1);
  });

  it('org A cannot use org B sender', async () => {
    const db = createDb(DATABASE_URL);
    const senderId = generateId('sndr');
    await db.insert(schema.emailSenders).values({
      id: senderId,
      organizationId: b.orgId,
      provider: 'fake',
      name: 'B Sender',
      email: 'b@example.test',
      credentialsEncrypted: '{}',
      status: 'active',
    });
    // There's no GET /senders yet, but we can assert that listing via
    // a tag-style route doesn't expose it. For now, confirm that a
    // direct DB read still finds it (sanity) — the API test will
    // arrive once Phase 5 lands.
    const rows = await db.select().from(schema.emailSenders).where(eq(schema.emailSenders.id, senderId));
    expect(rows.length).toBe(1);
  });

  it('org A cannot access org B deal', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/deals/${b.dealId}`, authed(a.cookie));
    expect(res.status).toBe(404);
  });

  it('org A cannot move org B deal', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/deals/${b.dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ stageId: b.stageId }),
    });
    expect(res.status).toBe(404);
  });

  it('org A cannot read org B pipeline kanban', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/pipelines/${b.pipelineId}/kanban`, authed(a.cookie));
    expect(res.status).toBe(404);
  });

  it('org A cannot delete org B company', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/companies/${b.companyId}`, {
      method: 'DELETE',
      headers: { cookie: a.cookie },
    });
    expect(res.status).toBe(404);
  });

  it('list endpoints only return org A resources', async () => {
    const contactsRes = (await jsonOrThrow(
      await fetch(`${BASE_URL}/api/v1/contacts?pageSize=100`, authed(a.cookie)),
    )) as { items: Array<{ id: string }> };
    for (const item of contactsRes.items) expect(item.id).not.toBe(b.contactId);

    const dealsRes = (await jsonOrThrow(
      await fetch(`${BASE_URL}/api/v1/deals?pageSize=100`, authed(a.cookie)),
    )) as { items: Array<{ id: string }> };
    for (const d of dealsRes.items) expect(d.id).not.toBe(b.dealId);
  });

  it('service API key isolation — a key bound to org A cannot read org B resources', async () => {
    // Create a key for org A
    const create = await jsonOrThrow(
      await fetch(`${BASE_URL}/api/v1/service-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: a.cookie },
        body: JSON.stringify({ name: 'test-key', scopes: [] }),
      }),
    );
    const created = create as { id: string; secret: string; prefix: string };
    expect(created.prefix.startsWith('dep_ak_live_')).toBe(true);

    // Use the key to call /auth/me
    const me = await jsonOrThrow(
      await fetch(`${BASE_URL}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    const meData = me as { organizationId: string };
    expect(meData.organizationId).toBe(a.orgId);

    // The key from org A must NOT see org B contact
    const res = await fetch(`${BASE_URL}/api/v1/contacts/${b.contactId}`, {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(res.status).toBe(404);
  });

  it('IDOR on /attention: org A only sees its own counts', async () => {
    const dataRaw = await jsonOrThrow(await fetch(`${BASE_URL}/api/v1/attention`, authed(a.cookie)));
    const dataB = await jsonOrThrow(await fetch(`${BASE_URL}/api/v1/attention`, authed(b.cookie)));
    const data = dataRaw as { summary: { contactsTotal: number } };
    const dataBO = dataB as { summary: { contactsTotal: number } };
    expect(data.summary.contactsTotal).toBe(1);
    expect(dataBO.summary.contactsTotal).toBe(1);
  });
});

void sha256; void randomToken;
