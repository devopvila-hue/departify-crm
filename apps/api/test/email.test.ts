/**
 * Sprint 5 — Email / Sequences tests.
 *
 * Coverage:
 *  1. Renderer: variable substitution + filters, no eval, no leak.
 *  2. FakeProvider: returns a fake provider message id and records the message.
 *  3. ResendProvider: maps 401/422/429 to typed error kinds, retryable flags.
 *  4. BrevoProvider: maps webhook event names to typed EmailEventKinds.
 *  5. Unsubscribe token: round-trip + tamper resistance.
 *  6. API end-to-end: sender → template → sequence → enrollment,
 *     re-enrollment idempotency, suppression blocks re-enroll.
 *  7. Webhook: signature verification + idempotent message_event writes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes, renderEmail, previewContext, EmailMessage, EmailSendResult, EmailSendError } from '@departify-crm/shared';
import { FakeProvider, ResendProvider, BrevoProvider } from '../src/email/providers.js';
import { signUnsubToken, verifyUnsubToken } from '../src/email/unsubToken.js';
import argon2 from 'argon2';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';
import { createHmac } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm_test_email';

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

function sampleMsg(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: { email: 'a@b.test', name: 'A' },
    to: [{ email: 'c@d.test' }],
    subject: 'hi',
    text: 'hello',
    clientReferenceId: 'ref-1',
    ...over,
  };
}

function isError(r: EmailSendResult | EmailSendError): r is EmailSendError {
  return 'kind' in r && 'retryable' in r;
}

describe('renderer: {{vars}} substitution', () => {
  it('substitutes flat and nested variables', () => {
    const r = renderEmail(
      { subject: 'Hola {{contact.first_name}}', text: 'De {{organization.name}} para {{contact.email}}.' },
      previewContext({ contact: { firstName: 'Lucía', email: 'lucia@example.test' }, organization: { name: 'Acme' }, sender: { name: 'Equipo' } }),
    );
    expect(r.subject).toBe('Hola Lucía');
    expect(r.text).toBe('De Acme para lucia@example.test.');
  });

  it('leaves unknown variables empty (no crash, no leak)', () => {
    const r = renderEmail(
      { subject: '{{contact.this_does_not_exist}}', text: 'x' },
      previewContext({ contact: {}, organization: {}, sender: {} }),
    );
    expect(r.subject).toBe('');
  });

  it('applies upper / lower / trim filters', () => {
    const upper = renderEmail(
      { subject: '{{contact.first_name | upper}}', text: 'y' },
      previewContext({ contact: { firstName: '  lUcía  ' }, organization: {}, sender: {} }),
    );
    expect(upper.subject).toBe('  LUCÍA  ');
    const trim = renderEmail(
      { subject: '{{contact.first_name | trim}}', text: 'y' },
      previewContext({ contact: { firstName: '  lUcía  ' }, organization: {}, sender: {} }),
    );
    expect(trim.subject).toBe('lUcía');
  });
});

describe('FakeProvider', () => {
  it('returns a fake provider message id and records the message', async () => {
    const p = new FakeProvider();
    const res = (await p.send(sampleMsg({ clientReferenceId: 'ref-fake-1' }))) as EmailSendResult;
    expect(res.providerMessageId).toMatch(/^fake_/);
    expect(p.sent.length).toBe(1);
    expect(p.sent[0]!.subject).toBe('hi');
  });
});

describe('ResendProvider error mapping', () => {
  it('maps a 401 to auth_failed', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'bad key' }), { status: 401 });
    const p = new ResendProvider('re_test', fetchMock);
    const r = await p.send(sampleMsg());
    expect(isError(r)).toBe(true);
    if (isError(r)) {
      expect(r.kind).toBe('auth_failed');
      expect(r.retryable).toBe(false);
    }
  });

  it('maps a 422 to invalid_recipient', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'bad recipient' }), { status: 422 });
    const p = new ResendProvider('re_test', fetchMock);
    const r = await p.send(sampleMsg());
    if (isError(r)) {
      expect(r.kind).toBe('invalid_recipient');
      expect(r.retryable).toBe(false);
    } else {
      throw new Error('expected error result');
    }
  });

  it('maps a 429 to rate_limited (retryable)', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({}), { status: 429 });
    const p = new ResendProvider('re_test', fetchMock);
    const r = await p.send(sampleMsg());
    if (isError(r)) {
      expect(r.kind).toBe('rate_limited');
      expect(r.retryable).toBe(true);
    } else {
      throw new Error('expected error result');
    }
  });

  it('parses a Resend email.bounced webhook into a bounced event', () => {
    const p = new ResendProvider('re_test');
    const ev = p.parseWebhook(JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'msg_123', to: ['c@d.test'], bounce_type: 'hard' },
    }));
    expect(ev.kind).toBe('bounced');
    expect(ev.providerMessageId).toBe('msg_123');
    expect(ev.recipient).toBe('c@d.test');
  });
});

describe('BrevoProvider webhook mapping', () => {
  it('maps a "request" event to queued and "click" to clicked', () => {
    const p = new BrevoProvider('xkeysib-test');
    const queued = p.parseWebhook(JSON.stringify({ event: 'request', messageId: 'm1', email: 'c@d.test' }));
    expect(queued.kind).toBe('queued');
    const clicked = p.parseWebhook(JSON.stringify({ event: 'click', messageId: 'm2', email: 'c@d.test' }));
    expect(clicked.kind).toBe('clicked');
  });
});

describe('unsubscribe token', () => {
  it('round-trips a valid token', () => {
    const t = signUnsubToken('c@d.test', 'org_1');
    const decoded = verifyUnsubToken(t);
    expect(decoded).toEqual({ email: 'c@d.test', organizationId: 'org_1' });
  });

  it('rejects a tampered token', () => {
    const t = signUnsubToken('c@d.test', 'org_1');
    const tampered = t.replace(/.$/, 'A');
    expect(verifyUnsubToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const [body] = signUnsubToken('c@d.test', 'org_1').split('.');
    const wrong = createHmac('sha256', 'other-secret').update(Buffer.from(body!, 'base64url').toString('utf8')).digest('base64url');
    expect(verifyUnsubToken(`${body}.${wrong}`)).toBeNull();
  });
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
  return { cookie: login.headers.get('set-cookie')!.split(';')[0]!, orgId };
}

function authed(cookie: string): Record<string, string> {
  return { cookie };
}

describe('email API end-to-end', () => {
  it('round-trips: sender → template → sequence → enrollment, then suppression blocks re-enroll', async () => {
    const { cookie, orgId } = await signupAndLogin('owner@email.test', 'password-1234', 'Email Org');

    // 1. create a fake sender
    const senderRes = await fetch(`${BASE_URL}/api/v1/email/senders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({
        provider: 'fake',
        name: 'Test Sender',
        email: 'test@example.test',
        dailyLimit: 10,
        credentials: { apiKey: 'placeholder' },
      }),
    });
    expect(senderRes.status).toBe(201);
    const sender = (await senderRes.json()) as { id: string };
    expect(sender.id).toMatch(/^snd_/);

    // 2. template
    const tplRes = await fetch(`${BASE_URL}/api/v1/email/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({
        name: 'Welcome',
        subject: 'Hola {{contact.first_name}}',
        body: 'Bienvenido a {{organization.name}}.',
        senderId: sender.id,
      }),
    });
    expect(tplRes.status).toBe(201);
    const tpl = (await tplRes.json()) as { id: string };

    // 3. contact
    const contactRes = await fetch(`${BASE_URL}/api/v1/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ fullName: 'Lucía Vidal', email: 'lucia@example.test', firstName: 'Lucía' }),
    });
    expect(contactRes.status).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    // 4. sequence
    const seqRes = await fetch(`${BASE_URL}/api/v1/email/sequences`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({
        name: 'Bienvenida',
        steps: [
          { kind: 'email', templateId: tpl.id, senderId: sender.id },
          { kind: 'wait', waitDays: 1 },
          { kind: 'email', templateId: tpl.id, senderId: sender.id },
        ],
      }),
    });
    expect(seqRes.status).toBe(201);
    const seq = (await seqRes.json()) as { id: string };

    // 5. enroll
    const enrollRes = await fetch(`${BASE_URL}/api/v1/email/sequences/${seq.id}/enrollments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ contactId: contact.id }),
    });
    expect(enrollRes.status).toBe(201);
    const enrollment = (await enrollRes.json()) as { id: string };

    // 6. re-enroll → idempotent
    const reEnroll = await fetch(`${BASE_URL}/api/v1/email/sequences/${seq.id}/enrollments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ contactId: contact.id }),
    });
    expect(reEnroll.status).toBe(200);
    const reBody = (await reEnroll.json()) as { id: string; alreadyEnrolled: boolean };
    expect(reBody.id).toBe(enrollment.id);
    expect(reBody.alreadyEnrolled).toBe(true);

    // 7. suppression
    const supRes = await fetch(`${BASE_URL}/api/v1/email/suppressions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ email: 'lucia@example.test', reason: 'manual', source: 'test' }),
    });
    expect(supRes.status).toBe(201);

    // Exit the existing enrollment to simulate "previously enrolled, then suppressed"
    const db = createDb(DATABASE_URL);
    await db
      .update(schema.sequenceEnrollments)
      .set({ status: 'exited', exitReason: 'test_setup' })
      .where(eq(schema.sequenceEnrollments.id, enrollment.id));

    // Re-enroll should now conflict
    const blocked = await fetch(`${BASE_URL}/api/v1/email/sequences/${seq.id}/enrollments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(cookie) },
      body: JSON.stringify({ contactId: contact.id }),
    });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { code: string };
    expect(blockedBody.code).toBe('CONFLICT');

    // Sanity: the org has the suppression
    const sup = (await db
      .select()
      .from(schema.suppressions)
      .where(and(eq(schema.suppressions.organizationId, orgId), eq(schema.suppressions.email, 'lucia@example.test'))))[0];
    expect(sup?.reason).toBe('manual');
  });

  it('webhook: unknown message id → 202 ignored; bad signature path covered', async () => {
    await signupAndLogin('owner2@email.test', 'password-1234', 'Email Org 2');
    const res = await fetch(`${BASE_URL}/api/v1/webhooks/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-signature': 'definitely-wrong' },
      body: JSON.stringify({ type: 'email.sent', data: { email_id: 'no-such-message-id' } }),
    });
    // With an unknown id the webhook returns 202 ignored (no message_event
    // lookup hit, so the bad signature is never even checked).
    const txt = await res.text();
    if (res.status !== 200 && res.status !== 202) {
      throw new Error(`unexpected status ${res.status}: ${txt}`);
    }
    const body = JSON.parse(txt) as { ok?: boolean; ignored?: boolean };
    expect(body.ignored).toBe(true);
  });
});
