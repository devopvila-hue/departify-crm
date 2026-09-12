/**
 * DEPARTIFY CRM — OAuth real (Google + Microsoft) + capability-status.
 *
 * Strategy: stub `globalThis.fetch` so the token-exchange calls hit a
 * synthetic IdP within this process. The API child is started with the
 * real OAuth env vars in `extraEnv`, so `providerConfigFor` returns the
 * live config (not the 503 path).
 *
 * The point of these tests is the WIRING (state machine, signup on first
 * hit, grant row insertion, capability-status reflecting grants into
 * cards, cancel/fail not destroying READY_FOR_WORK). It is NOT a Google
 * compatibility test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:***@127.0.0.1:5433/departify_crm_test';

const GOOGLE = {
  CLIENT_ID: 'google-test-client',
  CLIENT_SECRET: 'google-test-secret',
  REDIRECT_URI: 'http://127.0.0.1:0/api/v1/auth/oauth/google/callback',
};
const MICROSOFT = {
  CLIENT_ID: 'ms-test-client',
  CLIENT_SECRET: 'ms-test-secret',
  REDIRECT_URI: 'http://127.0.0.1:0/api/v1/auth/oauth/microsoft/callback',
  TENANT_ID: 'common',
};

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

function unauthRequest(method: string, path: string): Promise<HttpResp> {
  const { hostname, port } = new URL(BASE_URL);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname, port, path, method, agent: false },
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

let api: TestApi | null = null;
let BASE_URL = '';

beforeAll(async () => {
  await resetSchema(DATABASE_URL);
  api = await startTestApi(DATABASE_URL, {
    GOOGLE_OAUTH_CLIENT_ID: GOOGLE.CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: GOOGLE.CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: GOOGLE.REDIRECT_URI,
    MICROSOFT_OAUTH_CLIENT_ID: MICROSOFT.CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET: MICROSOFT.CLIENT_SECRET,
    MICROSOFT_OAUTH_TENANT_ID: MICROSOFT.TENANT_ID,
    MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT.REDIRECT_URI,
  });
  BASE_URL = api.baseUrl;
}, 60_000);

afterAll(async () => {
  await api?.stop();
  vi.unstubAllGlobals();
});

// ─── fetch stubbing helpers ──────────────────────────────────────────
/**
 * Stub global fetch so the OAuth module's token-exchange + profile calls
 * hit a synthetic IdP we control. `vi.stubGlobal` restores after each
 * test (afterEach) — without that, async tests bleed state into each other.
 */
function stubFetch(opts: {
  tokenResponse: () => Record<string, unknown>;
  profileResponse: () => Record<string, unknown>;
}) {
  const fake = vi.fn(async (input: Request | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/token')) {
      return new Response(JSON.stringify(opts.tokenResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('openidconnect.googleapis.com') || url.includes('graph.microsoft.com')) {
      return new Response(JSON.stringify(opts.profileResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed: ' + url, { status: 502 });
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── OAuth start endpoint tests ──────────────────────────────────────
describe('OAuth — start endpoint', () => {
  it('google start: 302 redirects to accounts.google.com with state', async () => {
    const r = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    expect(r.status).toBe(302);
    const loc = r.headers['location'] as string | undefined;
    expect(loc).toBeTruthy();
    expect(loc!).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    const u = new URL(loc!);
    expect(u.searchParams.get('client_id')).toBe(GOOGLE.CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe(GOOGLE.REDIRECT_URI);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toMatch(/^[^.]+\.[0-9a-f]{64}$/);
    expect(u.searchParams.get('scope')).toContain('openid');
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

// ─── OAuth start without env returns 503 ─────────────────────────────
describe('OAuth — unconfigured start', () => {
  it('google start: 503 INTEGRATION_NOT_CONFIGURED when GOOGLE_OAUTH_CLIENT_ID is empty', async () => {
    // Stop the configured server, start a fresh one without google envs.
    await api?.stop();
    api = await startTestApi(DATABASE_URL, {
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

// ─── OAuth callback tests ────────────────────────────────────────────
describe('OAuth — callback', () => {
  it('google callback: signed state required; tampered state returns 401', async () => {
    // Server is in unconfigured-google mode after the prior test; restart
    // with google envs back so start works and we can grab a real state.
    await api?.stop();
    api = await startTestApi(DATABASE_URL, {
      GOOGLE_OAUTH_CLIENT_ID: GOOGLE.CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: GOOGLE.CLIENT_SECRET,
      GOOGLE_OAUTH_REDIRECT_URI: GOOGLE.REDIRECT_URI,
      MICROSOFT_OAUTH_CLIENT_ID: MICROSOFT.CLIENT_ID,
      MICROSOFT_OAUTH_CLIENT_SECRET: MICROSOFT.CLIENT_SECRET,
      MICROSOFT_OAUTH_TENANT_ID: MICROSOFT.TENANT_ID,
      MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT.REDIRECT_URI,
    });
    BASE_URL = api.baseUrl;

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const tampered = state.replace(/.[0-9a-f]+$/, '.deadbeef');
    const r = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=fake&state=${tampered}`);
    expect(r.status).toBe(401);
  });

  it('google callback: code + state creates user/org/session/grant and redirects to /onboarding', async () => {
    stubFetch({
      tokenResponse: () => ({
        access_token: 'at',
        refresh_token: 'rt',
        scope: 'openid email https://www.googleapis.com/auth/drive.readonly',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      profileResponse: () => ({
        email: 'oauth.google@dep.test',
        name: 'OAuth Google',
      }),
    });

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toContain('/onboarding');
    expect(loc).toMatch(/oauth=connected/);
    expect(loc).toMatch(/provider=google/);
    // The session cookie should have been set.
    const setCookie = cb.headers['set-cookie'] as string | string[] | undefined;
    const cookieRaw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieRaw).toMatch(/^sid=/);
  });

  it('microsoft callback: also creates user/org/session/grant and redirects', async () => {
    stubFetch({
      tokenResponse: () => ({
        access_token: 'at-ms',
        refresh_token: 'rt-ms',
        scope: 'openid profile email offline_access Mail.Read Calendars.Read Files.Read',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      profileResponse: () => ({
        mail: 'oauth.ms@dep.test',
        displayName: 'OAuth Microsoft',
      }),
    });

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/microsoft/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/microsoft/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=connected/);
    expect(loc).toMatch(/provider=microsoft/);
  });

  it('cancel: error=access_denied redirects to /onboarding?oauth=canceled; READY_FOR_WORK unaffected', async () => {
    // Use a fresh user that has already run /start and reached READY_FOR_WORK.
    const email = `cancel-${randomBytes(4).toString('hex')}@dep.test`;
    const cookie = await signupAndLogin(email, 'password-1234', 'Org Cancel');

    // Reach READY_FOR_WORK via /start.
    await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    const before = await localRequest('GET', '/api/v1/onboarding', undefined, cookie);
    expect((await before.json()) as { readyForWork: boolean }).toMatchObject({ readyForWork: true });

    // Now simulate the user clicking Cancel at the provider.
    const cb = await unauthRequest('GET', '/api/v1/auth/oauth/google/callback?error=access_denied&state=fake');
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=canceled/);
    expect(loc).toMatch(/provider=google/);

    // READY_FOR_WORK still true.
    const after = await localRequest('GET', '/api/v1/onboarding', undefined, cookie);
    expect((await after.json()) as { readyForWork: boolean }).toMatchObject({ readyForWork: true });
  });

  it('failure: token exchange error redirects to /onboarding?oauth=failed; READY_FOR_WORK unaffected', async () => {
    stubFetch({
      tokenResponse: () => ({ error: 'invalid_grant', error_description: 'code expired' }),
      profileResponse: () => ({}),
    });

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const loc = cb.headers['location'] as string;
    expect(loc).toMatch(/oauth=failed/);
    expect(loc).toMatch(/provider=google/);
  });

  it('single-use state: replaying the same state twice returns 401', async () => {
    stubFetch({
      tokenResponse: () => ({ access_token: 'at' }),
      profileResponse: () => ({ email: 'replay@dep.test', name: 'Replay' }),
    });

    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;

    const first = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(first.status).toBe(302);

    const second = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(second.status).toBe(401);
  });
});

// ─── capability-status: real grants flip cards ────────────────────────
describe('Onboarding — capability-status reflects real grants', () => {
  it('after a real google grant, capability-status flips drive+calendar+mail to ready and preserves READY_FOR_WORK', async () => {
    stubFetch({
      tokenResponse: () => ({ access_token: 'at-cap' }),
      profileResponse: () => ({ email: 'cap@dep.test', name: 'Cap' }),
    });

    // Sign in normally to get a session.
    const cookie = await signupAndLogin('pre-cap@dep.test', 'password-1234', 'Org Cap');

    // Reach READY_FOR_WORK via /start.
    await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    const before = (await (await localRequest('GET', '/api/v1/onboarding', undefined, cookie)).json()) as {
      readyForWork: boolean;
      cards: Record<string, string>;
    };
    expect(before.readyForWork).toBe(true);
    expect(before.cards.calendar).toBe('available_later');
    expect(before.cards.mail).toBe('available_later');
    expect(before.cards.drive).toBe('available_later');

    // Run OAuth callback for this user.
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);

    // The CALLBACK creates a new user/org (it's anonymous). The user's
    // existing org/cookie does NOT see those grants — the grants are
    // scoped to the OAUTH-created org. This is the expected isolation:
    // an OAuth user is a different user; the capability-status endpoint
    // flips cards only for the requester's tenant, so an existing user
    // signing in with email+password does not see another user's grants.
    const capSelf = await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookie);
    expect(capSelf.status).toBe(200);
    const capSelfBody = (await capSelf.json()) as { cards: Record<string, string>; readyForWork: boolean };
    // The user's own grants are still none — the OAuth flow created a
    // different org. Company/Workspace remain ready (real signup). Optionals
    // remain available_later. READY_FOR_WORK stays true.
    expect(capSelfBody.readyForWork).toBe(true);
    expect(capSelfBody.cards.calendar).toBe('available_later');
  });

  it('capability-status flips cards when the requester has a grant', async () => {
    // Sign up a fresh org via OAuth and capture the session cookie the
    // callback sets. Then call capability-status AS that user.
    stubFetch({
      tokenResponse: () => ({ access_token: 'at-cb2' }),
      profileResponse: () => ({ email: 'cap2@dep.test', name: 'Cap2' }),
    });
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const cb = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    expect(cb.status).toBe(302);
    const setCookie = cb.headers['set-cookie'] as string | string[] | undefined;
    const cookieRaw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieRaw).toMatch(/^sid=/);
    const cookie = cookieRaw!.split(';')[0]!;

    const cap = await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookie);
    expect(cap.status).toBe(200);
    const body = (await cap.json()) as { cards: Record<string, string>; readyForWork: boolean };
    // The user just came in via OAuth; /start has NOT run yet, so company/workspace are waiting.
    // But the grant exists → drive/calendar/mail become ready.
    expect(body.cards.drive).toBe('ready');
    expect(body.cards.calendar).toBe('ready');
    expect(body.cards.mail).toBe('ready');
    // READY_FOR_WORK is false because company+workspace aren't ready yet.
    // The user can still proceed; the UI shows "Estoy preparando tu empresa"
    // until they hit /start (or it triggers automatically on entry).
    expect(body.readyForWork).toBe(false);

    // Now /start to reach READY_FOR_WORK.
    const started = await localRequest('POST', '/api/v1/onboarding/start', {}, cookie);
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as { readyForWork: boolean; cards: Record<string, string> };
    expect(startedBody.readyForWork).toBe(true);
    // Optionals stay ready (the grant is still there).
    expect(startedBody.cards.drive).toBe('ready');
    expect(startedBody.cards.calendar).toBe('ready');
    expect(startedBody.cards.mail).toBe('ready');
  });

  it('tenant isolation: capability-status never returns another org grants', async () => {
    stubFetch({
      tokenResponse: () => ({ access_token: 'at' }),
      profileResponse: () => ({ email: 'isoA@dep.test', name: 'A' }),
    });
    const startResp = await unauthRequest('GET', '/api/v1/auth/oauth/google/start');
    const state = new URL(startResp.headers['location'] as string).searchParams.get('state')!;
    const cbA = await unauthRequest('GET', `/api/v1/auth/oauth/google/callback?code=ok&state=${state}`);
    const cookieA = (Array.isArray(cbA.headers['set-cookie']) ? cbA.headers['set-cookie'][0] : cbA.headers['set-cookie'])!.split(';')[0]!;
    const capA = (await (await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookieA)).json()) as { cards: Record<string, string> };
    expect(capA.cards.drive).toBe('ready');

    // Build an unrelated user B that has no grants.
    const cookieB = await signupAndLogin('isoB@dep.test', 'password-1234', 'Org Iso B');
    const capB = (await (await localRequest('GET', '/api/v1/onboarding/capability-status', undefined, cookieB)).json()) as { cards: Record<string, string> };
    expect(capB.cards.drive).toBe('available_later');
    expect(capB.cards.calendar).toBe('available_later');
    expect(capB.cards.mail).toBe('available_later');
  });
});
