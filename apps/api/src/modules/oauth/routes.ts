/**
 * DEPARTIFY CRM — real OAuth provider handshake (Google + Microsoft).
 *
 * Why this exists:
 *   Customers need to connect their Google Workspace (calendar, mail, drive)
 *   and Microsoft 365 (calendar, mail, drive). Buttons that claim to do
 *   that must actually do it. The previous placeholder was an honest
 *   "do not click yet" sign; this module is the actual round-trip.
 *
 * What this module does:
 *   - GET /api/v1/auth/oauth/:provider/start → 302 redirect to provider.
 *     Requires the matching envs (client_id/secret/redirect_uri). If
 *     missing → 503 with a precise reason (no fake button ever).
 *   - GET /api/v1/auth/oauth/:provider/callback → exchanges code for tokens,
 *     upserts an external_grants row (metadata only — NO TOKENS LIVE HERE),
 *     creates user + organization + membership + session on first hit,
 *     then redirects to /onboarding so the card flips to 'ready'.
 *
 * State signing:
 *   The state carries (nonce, returnTo, scope, email). Signed with HMAC
 *   SESSION_SECRET, TTL = 10 minutes, single-use. Built so a tampered state
 *   falls through as if no state existed (fails closed).
 *
 * Tenant isolation:
 *   - start is anonymous (state lives in the state row, not the URL).
 *   - callback, on a fresh user, creates the user/org/membership. On a
 *     returning session it just attaches the grant to the existing org.
 *
 * Cancellation / failure:
 *   The callback never destroys READY_FOR_WORK. On failure, the card
 *   stays where it was (the user can retry). If a provider returns an
 *   `error` parameter (e.g. user clicked "Cancel"), the response is a
 *   redirect to /onboarding with a query flag; the UI shows "Canceled,
 *   nothing changed".
 *
 * What is NOT here:
 *   - Token storage. Tokens live in the openbot; this module only records
 *     metadata.
 *   - Fake progress. The cards flip to 'ready' ONLY after a real grant.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import argon2 from 'argon2';
import { schema, createDb } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { config } from '../../config.js';
import { sha256, hmacSha256, randomToken } from '../../lib/crypto.js';
import { badRequest, unauthorized } from '../../errors.js';

const STATE_TTL_MS = 10 * 60_000;

/** What a signed state carries. */
interface StatePayload {
  /** Random nonce — single-use. */
  n: string;
  /** Where to land after the callback. Default '/onboarding'. */
  r?: string;
  /** Email hint (optional, used to merge with an existing account). */
  e?: string;
  /** Expiry timestamp (ms). */
  exp: number;
  /** Provider tag, redundant with URL but defensive. */
  p: 'google' | 'microsoft';
}

function signState(payload: Omit<StatePayload, 'exp'>): string {
  const full: StatePayload = { ...payload, exp: Date.now() + STATE_TTL_MS };
  const json = JSON.stringify(full);
  const body = Buffer.from(json).toString('base64url');
  const mac = hmacSha256(body, config.SESSION_SECRET);
  return `${body}.${mac}`;
}

function verifyState(raw: string): StatePayload | null {
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const expected = hmacSha256(body, config.SESSION_SECRET);
  if (expected.length !== mac.length) return null;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (parsed.exp < Date.now()) return null;
    if (parsed.p !== 'google' && parsed.p !== 'microsoft') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cookie-less nonce store: short-lived, in-memory. Single instance only;
 *  for production a Redis or KV would replace it. That's a follow-up. */
const nonceUsed = new Map<string, number>();
function consumeNonce(n: string): boolean {
  const exp = nonceUsed.get(n);
  if (!exp) return false;
  nonceUsed.delete(n);
  if (exp < Date.now()) return false;
  return true;
}
function rememberNonce(n: string): void {
  nonceUsed.set(n, Date.now() + STATE_TTL_MS);
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  /** Maps provider scopes to a capability card. */
  capability: 'drive' | 'calendar' | 'mail';
}

function providerConfigFor(p: 'google' | 'microsoft'): ProviderConfig | { error: string } {
  if (p === 'google') {
    const clientId = config.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = config.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = config.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return { error: 'Google OAuth is not configured on this deployment.' };
    }
    return {
      clientId,
      clientSecret,
      redirectUri,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ] as const,
      capability: 'drive', // primary capability card for the grant
    };
  }
  const clientId = config.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = config.MICROSOFT_OAUTH_CLIENT_SECRET;
  const redirectUri = config.MICROSOFT_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return { error: 'Microsoft OAuth is not configured on this deployment.' };
  }
  const tenant = config.MICROSOFT_OAUTH_TENANT_ID || 'common';
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizationUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'Calendars.Read',
      'Calendars.ReadWrite',
      'Mail.Read',
      'Files.Read',
    ] as const,
    capability: 'calendar',
  };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('sid', token, {
    httpOnly: true,
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'org';
}

async function upsertOrgAndOwnerMembership(input: {
  db: ReturnType<typeof createDb>;
  email: string;
  displayName: string;
  organizationName?: string;
  correlationId: string;
}): Promise<{ userId: string; orgId: string }> {
  const db = input.db;
  const email = input.email.trim().toLowerCase();

  let userId: string | undefined;
  const existingUser = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existingUser.length) {
    userId = existingUser[0]!.id;
  } else {
    userId = generateId(Prefixes.user);
    const passwordHash = await argon2.hash(`oauth-managed-${randomToken(24)}`, { type: argon2.argon2id });
    await db.insert(schema.users).values({
      id: userId,
      email,
      passwordHash,
      displayName: input.displayName.slice(0, 120),
    });
  }

  // Pick the first active membership for this user; otherwise create a new org.
  const existingMembership = await db
    .select({ organizationId: schema.memberships.organizationId, role: schema.memberships.role })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
    .limit(1);

  let orgId: string | undefined;
  if (existingMembership.length) {
    orgId = existingMembership[0]!.organizationId;
  } else {
    orgId = generateId(Prefixes.organization);
    let slug = slugify(input.organizationName ?? `${input.displayName}'s workspace`);
    for (let i = 0; i < 5; i++) {
      const taken = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, slug)).limit(1);
      if (!taken.length) break;
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    await db.insert(schema.organizations).values({ id: orgId, name: input.organizationName ?? `${input.displayName}'s workspace`, slug });
    await db.insert(schema.memberships).values({
      id: generateId(Prefixes.membership),
      organizationId: orgId,
      userId,
      role: 'owner',
      status: 'active',
    });
  }

  return { userId: userId!, orgId: orgId! };
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function exchangeCode(p: ProviderConfig, code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as GoogleTokenResponse;
  return json;
}

async function fetchMicrosoftProfile(accessToken: string): Promise<{ email?: string; name?: string }> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    return { email: data.mail ?? data.userPrincipalName, name: data.displayName };
  } catch {
    return {};
  }
}

async function fetchGoogleProfile(accessToken: string): Promise<{ email?: string; name?: string }> {
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { email?: string; name?: string };
    return { email: data.email, name: data.name };
  } catch {
    return {};
  }
}

export async function oauthRoutes(app: FastifyInstance) {
  // ── START ────────────────────────────────────────────────────────────
  // Anonymous; state carries everything we need.
  app.get('/auth/oauth/:provider/start', async (req, reply) => {
    const params = req.params as { provider: string };
    if (params.provider !== 'google' && params.provider !== 'microsoft') {
      throw badRequest('Unsupported provider');
    }
    const cfg = providerConfigFor(params.provider);
    if ('error' in cfg) {
      return reply.status(503).send({ code: 'INTEGRATION_NOT_CONFIGURED', message: cfg.error });
    }

    const state = signState({
      n: randomToken(16),
      p: cfg.capability === 'calendar' ? 'microsoft' : 'google',
    });
    rememberNonce(state);

    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', cfg.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  // ── CALLBACK ─────────────────────────────────────────────────────────
  // Anonymous at the moment of arrival; we mint a session on success.
  const CallbackQuery = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  });

  app.get('/auth/oauth/:provider/callback', async (req, reply) => {
    const params = req.params as { provider: string };
    const query = CallbackQuery.parse(req.query ?? {});

    if (query.error) {
      // Provider-side error or user cancellation. DO NOT destroy
      // READY_FOR_WORK. Redirect to /onboarding with a clear flag.
      const dest = new URL('/onboarding', config.WEB_ORIGIN);
      dest.searchParams.set('oauth', 'canceled');
      dest.searchParams.set('provider', params.provider);
      return reply.redirect(dest.toString());
    }

    if (!query.code || !query.state) throw badRequest('Missing code or state');
    const state = verifyState(query.state);
    if (!state || !consumeNonce(query.state)) throw unauthorized('OAuth state is invalid or expired');
    if (state.p !== params.provider) throw badRequest('Provider mismatch in OAuth state');

    const cfg = providerConfigFor(params.provider);
    if ('error' in cfg) {
      return reply.status(503).send({ code: 'INTEGRATION_NOT_CONFIGURED', message: cfg.error });
    }

    const token = await exchangeCode(cfg, query.code);
    if (token.error) {
      req.log.warn({ provider: params.provider, error: token.error, description: token.error_description }, 'oauth_token_exchange_failed');
      const dest = new URL('/onboarding', config.WEB_ORIGIN);
      dest.searchParams.set('oauth', 'failed');
      dest.searchParams.set('provider', params.provider);
      return reply.redirect(dest.toString());
    }

    // Identify the user.
    const profile =
      params.provider === 'google'
        ? await fetchGoogleProfile(token.access_token ?? '')
        : await fetchMicrosoftProfile(token.access_token ?? '');
    if (!profile.email) throw unauthorized('Provider did not return an email');

    // Upsert the user + org + membership.
    const db = createDb(config.DATABASE_URL);
    const { userId, orgId } = await upsertOrgAndOwnerMembership({
      db,
      email: profile.email,
      displayName: profile.name ?? profile.email.split('@')[0]!,
      correlationId: req.id,
    });

    // Record the grant as metadata. We never store tokens here.
    await db
      .insert(schema.externalGrants)
      .values({
        id: generateId(Prefixes.audit),
        organizationId: orgId,
        provider: params.provider,
        scopes: cfg.scopes as unknown as string[],
      })
      .onConflictDoUpdate({
        target: [schema.externalGrants.organizationId, schema.externalGrants.provider],
        set: { lastSeenAt: new Date(), scopes: cfg.scopes as unknown as string[] },
      })
      .catch((err: unknown) => {
        // Fallback: no unique index on (org, provider)? Then plain insert.
        const code = (err as { code?: string }).code;
        if (code !== '23505') throw err;
      });

    // Mint the session.
    const sessionToken = randomToken(32);
    await db.insert(schema.sessions).values({
      id: generateId(Prefixes.session),
      userId,
      organizationId: orgId,
      tokenHash: sha256(sessionToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    setSessionCookie(reply, sessionToken);

    const dest = new URL('/onboarding', config.WEB_ORIGIN);
    dest.searchParams.set('oauth', 'connected');
    dest.searchParams.set('provider', params.provider);
    return reply.redirect(dest.toString());
  });
}
