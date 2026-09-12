/**
 * DEPARTIFY CRM — onboarding preparation (E2E, real Postgres).
 *
 * Contract under test (P0.2 / P0.5):
 *  - System-driven setup. Nothing in the UI ever advances card state.
 *  - /start runs REAL setup work (org + membership + audit probe) and
 *    persists the resulting card map. No fake delays, no fake progress.
 *  - Company + Workspace start as 'waiting' and become 'ready' when the
 *    backend's setup succeeds.
 *  - Calendar / Mail / Drive are NOT built. They default to 'available_later'
 *    and the UI must NOT be able to mark them 'ready' (no /move endpoint).
 *  - readyForWork = Company AND Workspace ready. The UI hero line mirrors
 *    that predicate, not "all connectors done".
 *  - Refresh is safe: GET /onboarding returns the same shape and the
 *    persisted state.
 *  - Tenant isolation: another org cannot see the first org's prep.
 *
 * Pattern notes: a tiny `localRequest` helper bypasses the host's egress
 * proxy (which would 502 plain localhost fetch); node:http with
 * `agent: false` talks to the loopback directly, matching curl.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';
import {
  derivePhase,
  isReadyForWork,
  isAllConnectionsReady,
  type PrepCards,
} from '../src/modules/onboarding/routes.js';

// DATABASE_URL is loaded from apps/api/.env via the `dotenv/config` import
// above. See oauth.test.ts for the rationale (sandbox masks env-passed URLs).
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — apps/api/.env must point at the test DB.');
}

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
  cards: PrepCards;
  readyForWork: boolean;
  allConnectionsReady: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

interface HttpResp {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: () => Promise<unknown>;
}

function localRequest(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResp> {
  const { hostname, port } = new URL(BASE_URL);
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
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            json: async () => (raw ? JSON.parse(raw) : null),
          }),
        );
      },
    );
    req.setTimeout(10_000, () => reject(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signupAndLogin(email: string, password: string, org: string): Promise<string> {
  const s = await localRequest('POST', '/api/v1/auth/signup', { email, password, displayName: 'Owner', organizationName: org });
  if (s.status !== 201) throw new Error(`signup failed: ${s.status} ${JSON.stringify(await s.json())}`);
  const l = await localRequest('POST', '/api/v1/auth/login', { email, password });
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`);
  const sc = l.headers['set-cookie'];
  const first = Array.isArray(sc) ? sc[0]! : sc!;
  return first.split(';')[0]!;
}

function getOnboarding(cookie: string): Promise<PrepResponse> {
  return localRequest('GET', '/api/v1/onboarding', undefined, cookie).then(async (r) => {
    expect(r.status).toBe(200);
    return (await r.json()) as PrepResponse;
  });
}

function startOnboarding(cookie: string): Promise<PrepResponse> {
  return localRequest('POST', '/api/v1/onboarding/start', {}, cookie).then(async (r) => {
    expect(r.status).toBe(200);
    return (await r.json()) as PrepResponse;
  });
}

describe('onboarding — system-driven preparation (P0.2 / P0.5)', () => {
  let cookie: string;
  let orgId: string;

  it('A. signs up and start runs real setup (Company+Workspace ready, no clicks)', async () => {
    cookie = await signupAndLogin('owner.p02.a@onboarding.test', 'password-1234', 'Org A');

    const before = await getOnboarding(cookie);
    expect(before.phase).toBe('not_started');
    expect(before.readyForWork).toBe(false);
    expect(before.cards.company).toBe('waiting');
    expect(before.cards.workspace).toBe('waiting');
    expect(before.cards.calendar).toBe('available_later');
    expect(before.cards.mail).toBe('available_later');
    expect(before.cards.drive).toBe('available_later');

    const started = await startOnboarding(cookie);
    orgId = started.organizationId;
    expect(orgId).toMatch(/^org_/);
    expect(started.cards.company).toBe('ready');
    expect(started.cards.workspace).toBe('ready');
    expect(started.readyForWork).toBe(true);
    expect(started.allConnectionsReady).toBe(true);
    expect(started.phase).toBe('ready');
  });

  it('B. optional cards stay available_later (no built integration)', async () => {
    const state = await getOnboarding(cookie);
    expect(state.cards.calendar).toBe('available_later');
    expect(state.cards.mail).toBe('available_later');
    expect(state.cards.drive).toBe('available_later');
  });

  it('C. readyForWork is true once Company + Workspace are ready', async () => {
    const state = await getOnboarding(cookie);
    expect(state.readyForWork).toBe(true);
    expect(state.cards.company).toBe('ready');
    expect(state.cards.workspace).toBe('ready');
  });

  it('D. refresh is safe and idempotent — state persists exactly', async () => {
    const before = await getOnboarding(cookie);
    const again = await getOnboarding(cookie);
    expect(again.organizationId).toBe(before.organizationId);
    expect(again.phase).toBe(before.phase);
    expect(again.cards).toEqual(before.cards);
    expect(again.readyForWork).toBe(true);
    expect(again.startedAt).toBe(before.startedAt);
    expect(again.completedAt).toBe(before.completedAt);

    const second = await startOnboarding(cookie);
    expect(second.startedAt).toBe(before.startedAt);
    expect(second.completedAt).toBe(before.completedAt);
  });

  it('E. there is no POST /onboarding/move endpoint exposed to the UI', async () => {
    const resp = await localRequest('POST', '/api/v1/onboarding/move', { card: 'calendar', state: 'ready' }, cookie);
    expect(resp.status).toBe(404);
  });

  it('F. tenant isolation: a second org starts fresh and cannot see org A', async () => {
    const cookie2 = await signupAndLogin('owner.p02.b@onboarding.test', 'password-1234', 'Org B');
    const before = await getOnboarding(cookie2);
    expect(before.phase).toBe('not_started');
    expect(before.readyForWork).toBe(false);
    expect(before.cards.company).toBe('waiting');
    expect(before.cards.workspace).toBe('waiting');
    expect(before.cards.calendar).toBe('available_later');

    await startOnboarding(cookie2);
    const aAfter = await getOnboarding(cookie);
    const bAfter = await getOnboarding(cookie2);
    expect(aAfter.organizationId).not.toBe(bAfter.organizationId);
    expect(aAfter.phase).toBe('ready');
    expect(bAfter.phase).toBe('ready');
  });
});

describe('onboarding — predicate unit tests', () => {
  it('isReadyForWork is true only when Company AND Workspace are ready', () => {
    expect(isReadyForWork({ company: 'ready', workspace: 'ready' })).toBe(true);
    expect(isReadyForWork({ company: 'ready', workspace: 'preparing' })).toBe(false);
    expect(isReadyForWork({ company: 'waiting', workspace: 'ready' })).toBe(false);
    expect(isReadyForWork({})).toBe(false);
  });

  it('isAllConnectionsReady tolerates available_later', () => {
    expect(
      isAllConnectionsReady({
        company: 'ready',
        workspace: 'ready',
        calendar: 'available_later',
        mail: 'available_later',
        drive: 'available_later',
      }),
    ).toBe(true);
  });

  it('isAllConnectionsReady is false while a BUILT card is still preparing', () => {
    expect(
      isAllConnectionsReady({
        company: 'ready',
        workspace: 'preparing',
        calendar: 'available_later',
      }),
    ).toBe(false);
  });

  it('derivePhase returns "needs_attention" if any card is in error/needs_permission', () => {
    expect(
      derivePhase({
        company: 'ready',
        workspace: 'ready',
        calendar: 'needs_permission',
      }),
    ).toBe('needs_attention');
  });

  it('derivePhase returns "partial" when READY_FOR_WORK but a built card is preparing', () => {
    expect(
      derivePhase({
        company: 'ready',
        workspace: 'ready',
        calendar: 'preparing',
      }),
    ).toBe('partial');
  });

  it('derivePhase returns "ready" when readyForWork AND allConnectionsReady', () => {
    expect(
      derivePhase({
        company: 'ready',
        workspace: 'ready',
        calendar: 'available_later',
        mail: 'available_later',
        drive: 'available_later',
      }),
    ).toBe('ready');
  });
});
