/**
 * CHILD-FETCH-STUB — load into the API child process ONLY during tests.
 *
 * Why: the API child (started by `startTestApi`) makes REAL network calls
 * to the OAuth provider during token exchange (`/token`) and profile fetch
 * (userinfo / graph.me). The test harness cannot monkey-patch that child
 * with vi.stubGlobal — it lives in a separate process. Without a stubbed
 * fetch, the child would dial the actual provider; on this host that is
 * blocked by the egress proxy (and even when allowed, would require real
 * credentials).
 *
 * Scope: TEST HARNESS artifact only. It loads when the child env carries
 * `OAUTH_TEST_MODE=1` and NODE_OPTIONS points at this file (wired from
 * oauth.test.ts beforeAll). It does NOT ship to production, and it does
 * NOT modify product code.
 *
 * Plain JS on purpose: `node --import` does not run tsx, so no TS syntax.
 *
 * It answers exactly two kinds of calls:
 *   - any URL containing `/token`               → synthetic token JSON
 *   - openidconnect.googleapis.com / graph.me  → synthetic profile JSON
 *   - anything else                             → 502 (never real network)
 *
 * The profile email is unique per invocation so each OAuth grant creates
 * a fresh user + org, keeping callback tests order-independent.
 */
if (process.env.OAUTH_TEST_MODE === '1') {
  const realFetch = globalThis.fetch;

  function onceEmail() {
    const rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return 'oauth.child.' + rnd + '@dep.test';
  }
  const EMAIL = onceEmail();

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    // Failure-injection mode: the test asks the callback's token-exchange
    // to fail (e.g. invalid_grant) by starting the API child with
    // OAUTH_TEST_TOKEN_MODE=fail.
    if (process.env.OAUTH_TEST_TOKEN_MODE === 'fail' && url.includes('/token')) {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'test-injected failure' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'at-child-stub',
          refresh_token: 'rt-child-stub',
          scope: 'openid email profile',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('openidconnect.googleapis.com') || url.includes('graph.microsoft.com')) {
      return new Response(
        JSON.stringify({ email: EMAIL, name: 'OAuth Child Stub', displayName: 'OAuth Child Stub', mail: EMAIL }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('child-fetch-stub: blocked ' + url, { status: 502 });
  };

  // eslint-disable-next-line no-console
  console.log('child-fetch-stub: armed (OAUTH_TEST_MODE)');
  void realFetch;
}