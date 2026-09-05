/**
 * Auth + tenant middleware.
 *
 * Two authentication paths are supported:
 *
 *  1. Cookie session (humans). The request carries a `sid` cookie whose
 *     value is an opaque token. The middleware looks it up in
 *     `sessions` (token stored as SHA-256) and, if valid, populates the
 *     tenant context.
 *
 *  2. API key (service-to-service). The request carries an
 *     `Authorization: Bearer <token>` header. Used by DEPARTIFY and any
 *     future automation. Looked up in `api_keys` and must be active.
 *
 * If neither is present, the request continues unauthenticated and the
 * route decides whether to require it (e.g. /api/v1/auth/login is open).
 */
import { eq, and, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { schema, createDb } from '@departify-crm/db';
import { sha256 } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../errors.js';
import type { TenantContext } from './context.js';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: TenantContext | undefined;
  }
}

function readSessionToken(req: FastifyRequest): string | null {
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (cookie?.sid) return cookie.sid;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Session ')) return auth.slice('Session '.length);
  return null;
}

function readApiKeyToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

export const requireAuth: preHandlerHookHandler = async (req, _reply) => {
  await attachTenant(req);
  if (!req.tenant) throw unauthorized();
};

export const requireRole = (
  minRole: 'owner' | 'admin' | 'member',
): preHandlerHookHandler => {
  const order: Record<'owner' | 'admin' | 'member', number> = { owner: 3, admin: 2, member: 1 };
  return async (req, _reply) => {
    await attachTenant(req);
    if (!req.tenant) throw unauthorized();
    if (req.tenant.actorKind !== 'user') {
      // Service actors bypass role checks; they carry scopes instead.
      return;
    }
    const have = order[req.tenant.role ?? 'member'];
    const need = order[minRole];
    if (have < need) throw forbidden('Insufficient role');
  };
};

export async function attachTenant(req: FastifyRequest): Promise<void> {
  const db = createDb(config.DATABASE_URL);

  // Service path first — API keys take precedence over cookie sessions.
  const apiToken = readApiKeyToken(req);
  if (apiToken) {
    const tokenHash = sha256(apiToken);
    const rows = await db
      .select()
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.tokenHash, tokenHash),
          eq(schema.apiKeys.status, 'active'),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .limit(1);
    const key = rows[0];
    if (!key) throw unauthorized('Invalid API key');
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) throw unauthorized('API key expired');
    // Touch last_used_at (best effort, fire-and-forget).
    void db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, key.id))
      .catch(() => undefined);

    req.tenant = {
      userId: null,
      organizationId: key.organizationId,
      actorKind: 'service',
      role: null,
      correlationId: req.id,
      db,
    };
    return;
  }

  // User path.
  const sessionToken = readSessionToken(req);
  if (!sessionToken) return;
  const tokenHash = sha256(sessionToken);
  const rows = await db
    .select({
      sessionOrgId: schema.sessions.organizationId,
      user: schema.users,
      membership: schema.memberships,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        gt(schema.sessions.expiresAt, new Date()),
        isNull(schema.sessions.revokedAt),
        eq(schema.memberships.organizationId, schema.sessions.organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;

  req.tenant = {
    userId: row.user.id,
    organizationId: row.sessionOrgId,
    actorKind: 'user',
    role: row.membership.role,
    correlationId: req.id,
    db,
  };
}

export const tenantPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('tenant', undefined);
  // Attach tenant on every request; routes opt into enforcement via
  // preHandler: [requireAuth] / [requireRole('admin')].
  app.addHook('preHandler', async (req) => {
    try {
      await attachTenant(req);
    } catch (err) {
      // Surface auth errors only when a route explicitly requires auth.
      // For open routes, leaving req.tenant undefined is fine.
      if (err instanceof Error) {
        (req as unknown as { _authError: Error })._authError = err;
      }
    }
  });
});
