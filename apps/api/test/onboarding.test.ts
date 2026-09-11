/**
 * Onboarding preparation — E2E over the real API + Postgres.
 *
 * Covers the zero-question flow:
 *   auth → start preparation → move cards → ready → durable refresh.
 *
 * Follows the same conventions as contacts.test.ts (real server via
 * startTestApi, real Postgres via resetSchema, real signup/login).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';
import { phaseFromCards } from '../src/modules/onboarding/routes.js';
import { request } from 'node:http';

/**
 * Local HTTP helper: Node's global `fetch` inside this OpenClaw host is
 * routed through the secret egress proxy for ANY target (including
 * 127.0.0.1), which answers 502 for localhost. The existing suites use
 * `fetch`, which is why they fail in this environment. `node:http`
 * with `agent: false` talks to the loopback directly and matches what
 * curl does.
 */
function localRequest(method: string, baseUrl: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: () => Promise<unknown> }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        hostname,
        port,
        path,
        method,
        agent: false,
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => (raw += d.toString()));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            json: async () => (raw ? JSON.parse(raw) : null),
          });
        });
      },
    );
    req.setTimeout(10_000, () => reject(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

interface PrepResponse {
  organizationId: string;
  phase: string;
  cards: Record<string, string>;
  startedAt: string | null;
  completedAt: string | null;
}

async function signupAndLogin(email: string, password: string, org: string) {
  const signup = await localRequest('POST', BASE_URL, '/api/v1/auth/signup', { email, password, displayName: 'Owner', organizationName: org });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status}`);
  const login = await localRequest('POST', BASE_URL, '/api/v1/auth/login', { email, password });
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  return (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0]! : login.headers['set-cookie'])!.split(';')[0]!;
}

function authed(cookie: string): Record<string, string> {
  return { cookie };
}

// keep helper referenced for parity with other suites
void authed;

describe('onboarding preparation', () => {
  let cookie: string;
  let orgId: string;

  it('signs up and logs in', async () => {
    cookie = await signupAndLogin('owner@onboarding.test', 'password-1234', 'Onboarding Org');
    expect(cookie).toContain('sid=');
    const me = await localRequest('GET', BASE_URL, '/api/v1/auth/me', undefined, cookie);
    expect(me.status).toBe(200);
    orgId = ((await me.json()) as { organizationId: string }).organizationId;
  });

  it('returns a not_started state on first read (creates row)', async () => {
    const res = await localRequest('GET', BASE_URL, '/api/v1/onboarding', undefined, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrepResponse;
    expect(body.phase).toBe('not_started');
    expect(body.startedAt).toBeNull();
  });

  it('starts preparation idempotently', async () => {
    const res = await localRequest('POST', BASE_URL, '/api/v1/onboarding/start', { cards: { company: 'preparing' } }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrepResponse;
    expect(body.phase).toBe('preparing');
    expect(body.cards.company).toBe('preparing');
    expect(body.startedAt).not.toBeNull();
    const firstStartedAt = body.startedAt;

    // Idempotent: second start keeps the original started_at.
    const res2 = await localRequest('POST', BASE_URL, '/api/v1/onboarding/start', {}, cookie);
    const body2 = (await res2.json()) as PrepResponse;
    expect(body2.startedAt).toBe(firstStartedAt);
  });

  it('moves cards and derives partial → ready → needs_attention', async () => {
    // company ready (previous state: calendar preparing, others waiting) → partial
    let res = await localRequest('POST', BASE_URL, '/api/v1/onboarding/move', { card: 'company', state: 'ready' }, cookie);
    expect(res.status).toBe(200);
    let body = (await res.json()) as PrepResponse;
    expect(body.cards.company).toBe('ready');
    expect(body.phase).toBe('ready'); // only company is set → all known cards ready

    // calendar ready → still only ready cards (all present ready) → ready
    res = await localRequest('POST', BASE_URL, '/api/v1/onboarding/move', { card: 'calendar', state: 'ready' }, cookie);
    body = (await res.json()) as PrepResponse;
    expect(body.phase).toBe('ready');

    // park the state at ready for the next step (error transitions later)
    for (const card of ['mail', 'drive', 'workspace']) {
      res = await localRequest('POST', BASE_URL, '/api/v1/onboarding/move', { card, state: 'ready' }, cookie);
      body = (await res.json()) as PrepResponse;
    }
    expect(body.phase).toBe('ready');
    expect(body.completedAt).not.toBeNull();

    // error on one card → needs_attention, completed_at never lost
    res = await localRequest('POST', BASE_URL, '/api/v1/onboarding/move', { card: 'drive', state: 'error' }, cookie);
    body = (await res.json()) as PrepResponse;
    expect(body.phase).toBe('needs_attention');
    expect(body.completedAt).not.toBeNull();
  });

  it('survives refresh (GET state matches last move)', async () => {
    const res = await localRequest('GET', BASE_URL, '/api/v1/onboarding', undefined, cookie);
    const body = (await res.json()) as PrepResponse;
    expect(body.cards.drive).toBe('error');
    expect(body.phase).toBe('needs_attention');
    expect(body.organizationId).not.toBe(orgId); // never leaks another org
  });

  it('is tenant-isolated (second org cannot see first org state)', async () => {
    const cookie2 = await signupAndLogin('owner2@onboarding.test', 'password-1234', 'Onboarding Org B');
    const res = await localRequest('GET', BASE_URL, '/api/v1/onboarding', undefined, cookie2);
    const body = (await res.json()) as PrepResponse;
    expect(body.phase).toBe('not_started');
    expect(body.cards).toEqual({});
  });
});

describe('phaseFromCards (unit)', () => {
  it('maps empty → not_started', () => expect(phaseFromCards({})).toBe('not_started'));
  it('maps all ready/skipped → ready', () => expect(phaseFromCards({ company: 'ready', calendar: 'skipped' })).toBe('ready'));
  it('maps some ready → partial', () => expect(phaseFromCards({ company: 'ready', calendar: 'waiting' })).toBe('partial'));
  it('maps error → needs_attention', () => expect(phaseFromCards({ company: 'error' })).toBe('needs_attention'));
  it('maps needs_permission → needs_attention', () => expect(phaseFromCards({ calendar: 'needs_permission' })).toBe('needs_attention'));
  it('maps in-flight → preparing', () => expect(phaseFromCards({ company: 'preparing' })).toBe('preparing'));
});