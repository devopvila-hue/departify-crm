/**
 * DEPARTIFY CRM — OAuth real (Google + Microsoft) + capability-status.
 *
 * Strategy: the API *child* (started by `startTestApi`) makes the real
 * OAuth network calls (token exchange + profile). A separate process
 * cannot be patched with vi.stubGlobal, so the child runs with
 * `OAUTH_TEST_MODE=1`, which makes `startTestApi` load
 * `test/helpers/child-fetch-stub.mjs` into that child via
 * NODE_OPTIONS --import. The stub answers `/token`, userinfo and
 * graph.me with synthetic data and issues a fresh unique profile email
 * per child boot, so each OAuth callback creates a new user/org and
 * tests stay order-independent.
 *
 * The point of these tests is the WIRING (state machine, signup on
 * first hit, grant row insertion, capability-status reflecting grants,
 * cancel/fail not destroying READY_FOR_WORK) — NOT provider semantics.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';

// DATABASE_URL is loaded from apps/api/.env via the `dotenv/config` import
// above. The host's bash sandbox masks alphanumerics in env vars passed
// via process.env when spawning the vitest fork, so a hardcoded fallback
// URL with a real password arrives as asterisks; .env is the only
// reliable source.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — apps/api/.env must point at the test DB.');
}

const GOOGLE = {
  CLIENT_ID: 'google-test-client',
  CLIENT_SECRET: 'gs',
  REDIRECT_URI: 'http://127.0.0.1:0/api/v1/auth/oauth/google/callback',
};
const MICROSOFT = {
  CLIENT_ID: 'ms-test-client',
  CLIENT_SECRET: 'ms',
  REDIRECT_URI: 'http://127.0.0.1:0/api/v1/auth/oauth/microsoft/callback',
  TENANT_ID: 'common',
};

function oauthChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    OAUTH_TEST_MODE: '1',
    GOOGLE_OAUTH_CLIENT_ID: GOOGLE.CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GOOGLE.CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: GOOGLE.REDIRECT_URI,
    MICROSOFT_OAUTH_CLIENT_ID: MICROSOFT.CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET: MICROSOFT.CLIENT_SECRET,
    MICROSOFT_OAUTH_TENANT_ID: MICROSOFT.TENANT_ID,
    MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT.REDIRECT_URI,
    ...extra,
  };
}

let api: TestApi | null = null;
let BASE_URL = '';

beforeAll(async () => {
  await resetSchema(DATABASE_URL);
  api = await startTestApi(DATABASE_URL, oauthChildEnv());
  BASE_URL = api.baseUrl;
}, 60_000);

afterAll(async () => {
  await api?.stop();
});

interface HttpResp {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: () => Promise<unknown>;
}

/**
 * Raw-socket HTTP client. node:http with agent:false can drop
 * Location/Set-Cookie headers on 302 responses in some environments;
 * the raw wire always carries them (verified end-to-end). The OAuth
 * callbacks depend on these headers, so this is the reliable path.
 */
function rawRequest(hostname: string, port: number, method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port }, () => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      let req = `${method} ${path} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n`;
      if (payload) req += `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n`;
      if (cookie) req += `Cookie: ${cookie}\r\n`;
      req += '\r\n';
      if (payload) req += payload;
      socket.write(req);
    });
    let buf = '';
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.on('data', (d) => (buf += d.toString()));
    socket.on('close', () => {
      const sep = buf.indexOf('\r\n\r\n');
      const head = sep === -1 ? buf : buf.slice(0, sep);
      const body = sep === -1 ? '' : buf.slice(sep + 4);
      const lines = head.split(/\r?\n/);
      const statusMatch = (lines[0] ?? '').match(/^HTTP\/\S+\s+(\d+)/);
      const headers: Record<string, string | string[] | undefined> = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (headers[key] === undefined) headers[key] = value;
        else if (Array.isArray(headers[key])) (headers[key] as string[]).push(value);
        else headers[key] = [headers[key] as string, value];
      }
      resolve({ status: statusMatch ? Number(statusMatch[1]) : 0, headers, json: async () => (body ? JSON.parse(body) : null) });
    });
    socket.on('error', reject);
  });
}

function unauthRequest(method: string, path: string): Promise<HttpResp> {
  const { hostname, port } = new URL(BASE_URL);
  return rawRequest(hostname, Number(port), method, path);
}

function localRequest(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResp> {
  const { hostname, port } = new URL(BASE_URL);
  return rawRequest(hostname, Number(port), method, path, body, cookie);
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

function cookieFrom(resp: HttpResp): string {
  const sc = resp.headers['set-cookie'];
  const first = Array.isArray(sc) ? sc[0]! : sc;
  if (!first) throw new Error('expected set-cookie header');
  return first.split(';')[0]!;
}

// ─── OAuth start endpoint ────────────────────────────────────────────
describe('OAuth — start endpoint', () => {
  it('starts the API with the OAuth child stub (sanity)', () => {
    expect(api).not.toBeNull();
    expect(BASE_URL).toBeTruthy();
  });

  it('google start: 302 redirects to accounts.google.com with state', async () => {
    const r = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    expect(r.status).toBe(302);
    const loc = r.headers['location'] as string | undefined;
    expect(loc).toBeTruthy();
    expect(loc!).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    const u = new URL(loc!);
    expect(u.searchParams.get('client_id')).toBe(GOOGLE.CLIENT_ID);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toMatch(/^[^.]+\.[0-9a-f]{64}$/);
    expect(u.searchParams.get('prompt')).toBe('consent');
  });

  it('microsoft start: 302 redirects to login.microsoftonline.com with tenant', async () => {
    const r = await unauthRequest('GET', '/api/v1/auth/oauth/microsoft/start');
    expect(r.status).toBe(302);
    const loc = r.headers['location'] as string;
    expect(loc).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
    const u = new URL(loc);
    expect(u.searchParams.get('client_id')).toBe(MICROSOFT.CLIENT_ID);
    expect(u.searchParams.get('scope')).toContain('openid');
  });

  it('unsupported provider: 400', async () => {
    const r = await unauthRequest('GET', '/api/v1/auth/oauth/facebook/start');
    expect(r.status).toBe(400);
  });
});

// ─── OAuth unconfigured start ────────────────────────────────────────
describe('OAuth — unconfigured start', () => {
  it('google start: 503 INTEGRATION_NOT_CONFIGURED when GOOGLE_OAUTH_CLIENT_ID is absent', async () => {
    await api?.stop();
    api = await startTestApi(DATABASE_URL, {
      OAUTH_TEST_MODE: '1',
      MICROSOFT_OAUTH_CLIENT_ID: MICROSOFT.CLIENT_ID,
      MICROSOFT_OAUTH_CLIENT_SECRET: MICROSOFT.CLIENT_SECRET,
      MICROSOFT_OAUTH_TENANT_ID: MICROSOFT.TENANT_ID,
      MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT.REDIRECT_URI,
    });
    BASE_URL = api.baseUrl;
    const r = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    expect(r.status).toBe(503);
    const body = (await r.json()) as { code: string; message: string };
    expect(body.code).toBe('INTEGRATION_NOT_CONFIGURED');
    expect(body.message).toMatch(/Google OAuth/);
  });
});

// ─── OAuth callback ──────────────────────────────────────────────────
describe('OAuth — callback', () => {
  it('restarts the API with both providers configured', async () => {
    await api?.stop();
    api = await startTestApi(DATABASE_URL, oauthChildEnv());
    BASE_URL = api.baseUrl;
  });

  it('google callback: tampered state returns 401', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const tampered = state.replace(/.[0-9a-f]+$/, '.deadbeef');
    const r = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${tampered}`);
    expect(r.status).toBe(401);
  });

  it('google callback: code + state creates user/org/session/grant and redirects to /onboarding', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toContain('/onboarding');
    expect(loc).toMatch(/oauth=connected/);
    expect(loc).toMatch(/provider=google/);
    const cookie = cookieFrom(cb);
    expect(cookie).toMatch(/^sid=/);
  });

  it('microsoft callback: also creates user/org/session/grant and redirects', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/microsoft/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/microsoft/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=connected/);
    expect(loc).toMatch(/provider=microsoft/);
    expect(cookieFrom(cb)).toMatch(/^sid=/);
  });

  it('cancel: error=access_denied redirects to /onboarding?oauth=canceled; READY_FOR_WORK unaffected', async () => {
    const email = `cancel-${randomBytes(4).toString('hex')}@dep.test`;
    const cookie = await signupAndLogin(email, 'password-1234', 'Org Cancel');
    await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    const before = await localRequest('GET', '/api/v1/onboarding', undefined, cookie);
    expect((await before.json()) as { readyForWork: boolean }).toMatchObject({ readyForWork: true });

    const cb = await unauthRequest('GET', '/api/v1/auth/oauth/google/callback?error=access_denied&state=fake');
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=canceled/);
    expect(loc).toMatch(/provider=google/);

    const after = await localRequest('GET', '/api/v1/onboarding', undefined, cookie);
    expect((await after.json()) as { readyForWork: boolean }).toMatchObject({ readyForWork: true });
  });

  it('single-use state: replaying the same state twice returns 401', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const first = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(first.status).toBe(302);

    const second = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(second.status).toBe(401);
  });
});

// ─── OAuth callback failure (separate child with injected failure) ────
describe('OAuth — callback failure mode', () => {
  it('token exchange error redirects to /onboarding?oauth=failed; does not crash', async () => {
    await api?.stop();
    api = await startTestApi(DATABASE_URL, oauthChildEnv({ OAUTH_TEST_TOKEN_MODE: 'fail' }));
    BASE_URL = api.baseUrl;

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=failed/);
    expect(loc).toMatch(/provider=google/);
  });
});

// ─── capability-status reflects real grants ──────────────────────────
describe('Onboarding — capability-status reflects real grants', () => {
  it('restarts the API with the success stub', async () => {
    await api?.stop();
    api = await startTestApi(DATABASE_URL, oauthChildEnv());
    BASE_URL = api.baseUrl;
  });

  it('existing email+password user is unaffected by another user OAuth grant (tenant isolation)', async () => {
    const cookie = await signupAndLogin(`pre-${randomBytes(4).toString('hex')}@dep.test`, 'password-1234', 'Org Cap');
    await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    const before = (await (await localRequest('GET', '/api/v1/onboarding', undefined, cookie)).json()) as {
      readyForWork: boolean;
      cards: Record<string, string>;
    };
    expect(before.readyForWork).toBe(true);
    expect(before.cards.calendar).toBe('available_later');

    // Run an OAuth callback as a DIFFERENT (anonymous) identity — the
    // child stub mints a unique email per boot, so this creates a fresh
    // user/org with its own grant row.
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);

    // The first user's own grants remain empty; READY_FOR_WORK stays true.
    const capSelf = await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookie);
    expect(capSelf.status).toBe(200);
    const capSelfBody = (await capSelf.json()) as { cards: Record<string, string>; readyForWork: boolean };
    expect(capSelfBody.readyForWork).toBe(true);
    expect(capSelfBody.cards.calendar).toBe('available_later');
  });

  it('capability-status flips cards for the OAuth-created user (own grant)', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const cookie = cookieFrom(cb);

    const cap = await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookie);
    expect(cap.status).toBe(200);
    const body = (await cap.json()) as { cards: Record<string, string>; readyForWork: boolean };
    expect(body.cards.drive).toBe('ready');
    expect(body.cards.calendar).toBe('ready');
    expect(body.cards.mail).toBe('ready');
    expect(body.readyForWork).toBe(false);

    const started = await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as { readyForWork: boolean; cards: Record<string, string> };
    expect(startedBody.readyForWork).toBe(true);
    expect(startedBody.cards.drive).toBe('ready');
    expect(startedBody.cards.calendar).toBe('ready');
    expect(startedBody.cards.mail).toBe('ready');
  });

  it('tenant isolation: another org never sees the first org grants', async () => {
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const cbA = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    const cookieA = cookieFrom(cbA);
    const capA = (await (await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookieA)).json()) as { cards: Record<string, string> };
    expect(capA.cards.drive).toBe('ready');

    const cookieB = await signupAndLogin(`isoB-${randomBytes(4).toString('hex')}@dep.test`, 'password-1234', 'Org Iso B');
    const capB = (await (await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookieB)).json()) as { cards: Record<string, string> };
    expect(capB.cards.drive).toBe('available_later');
    expect(capB.cards.calendar).toBe('available_later');
    expect(capB.cards.mail).toBe('available_later');
  });
});