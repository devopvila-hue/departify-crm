import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import { schema, createDb } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { config } from '../../config.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, unauthorized, sendError } from '../../errors.js';
import { requireAuth } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

const COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const SignupBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120),
});

const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const OnboardBody = z.object({
  organizationName: z.string().min(1).max(120).optional(),
  /** Optional: link this CRM org to a DEPARTIFY org id. */
  externalId: z.string().min(1).max(120).optional(),
});

function setSessionCookie(reply: import('fastify').FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

function clearSessionCookie(reply: import('fastify').FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
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

export async function authRoutes(app: FastifyInstance) {
  const db = createDb(config.DATABASE_URL);

  app.post('/auth/signup', async (req, reply) => {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid signup body', { issues: parsed.error.flatten() });
    const { email, password, displayName, organizationName } = parsed.data;

    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing.length) throw conflict('Email already registered');

    const userId = generateId(Prefixes.user);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.insert(schema.users).values({ id: userId, email, passwordHash, displayName });

    const orgId = generateId(Prefixes.organization);
    let slug = slugify(organizationName);
    // ensure unique slug
    for (let i = 0; i < 5; i++) {
      const taken = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, slug)).limit(1);
      if (!taken.length) break;
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    await db.insert(schema.organizations).values({ id: orgId, name: organizationName, slug });
    await db.insert(schema.memberships).values({
      id: generateId(Prefixes.membership),
      organizationId: orgId,
      userId,
      role: 'owner',
      status: 'active',
    });

    const token = randomToken();
    await db.insert(schema.sessions).values({
      id: generateId(Prefixes.session),
      userId,
      organizationId: orgId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));

    setSessionCookie(reply, token);
    await audit(db, { userId, organizationId: orgId, actorKind: 'user', correlationId: req.id }, {
      action: 'login',
      resourceType: 'session',
    });

    return reply.status(201).send({
      user: { id: userId, email, displayName },
      organization: { id: orgId, name: organizationName, slug },
    });
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid login body', { issues: parsed.error.flatten() });
    const { email, password } = parsed.data;

    // We need the user + any active membership to know which org to log
    // them into. We pick the first active membership; switching orgs
    // is a future feature.
    const rows = await db
      .select({ user: schema.users, membership: schema.memberships })
      .from(schema.users)
      .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
      .where(and(eq(schema.users.email, email), eq(schema.memberships.status, 'active')))
      .limit(1);

    const row = rows[0];
    if (!row) throw unauthorized('Invalid credentials');
    const ok = await argon2.verify(row.user.passwordHash, password).catch(() => false);
    if (!ok) throw unauthorized('Invalid credentials');

    const token = randomToken();
    await db.insert(schema.sessions).values({
      id: generateId(Prefixes.session),
      userId: row.user.id,
      organizationId: row.membership.organizationId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, row.user.id));

    setSessionCookie(reply, token);
    await audit(db, { userId: row.user.id, organizationId: row.membership.organizationId, actorKind: 'user', correlationId: req.id }, {
      action: 'login',
      resourceType: 'session',
    });

    return reply.send({
      user: { id: row.user.id, email: row.user.email, displayName: row.user.displayName },
      organizationId: row.membership.organizationId,
    });
  });

  app.post('/auth/logout', { preHandler: [requireAuth] }, async (req, reply) => {
    const tenant = req.tenant!;
    // Revoke the session row matching the cookie token.
    const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    if (cookieToken) {
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.tokenHash, sha256(cookieToken)));
    }
    await audit(db, tenant, { action: 'logout', resourceType: 'session' });
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: [requireAuth] }, async (req, reply) => {
    const tenant = req.tenant!;
    if (tenant.actorKind !== 'user') {
      return reply.send({ user: null, organizationId: tenant.organizationId, actor: 'service' });
    }
    const rows = await tenant.db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.memberships.role,
        orgName: schema.organizations.name,
        orgSlug: schema.organizations.slug,
      })
      .from(schema.users)
      .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .where(and(eq(schema.users.id, tenant.userId!), eq(schema.memberships.organizationId, tenant.organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Membership missing' });
    return reply.send(row);
  });

  // Optional: switch active org context (multi-org user). For now
  // /auth/me just returns the user's first org; a separate /auth/switch
  // is left for Phase 7+.

  // Onboard an external (DEPARTIFY) mapping onto the user's current org.
  app.post('/auth/onboard-external', { preHandler: [requireAuth] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = OnboardBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() });
    const { externalId, organizationName } = parsed.data;
    if (externalId) {
      try {
        await tenant.db
          .update(schema.organizations)
          .set({ externalId, updatedAt: new Date() })
          .where(eq(schema.organizations.id, tenant.organizationId));
      } catch (err) {
        // unique violation on external_id
        if ((err as { code?: string }).code === '23505') throw conflict('External id already mapped to another organization');
        throw err;
      }
    }
    if (organizationName) {
      await tenant.db
        .update(schema.organizations)
        .set({ name: organizationName, updatedAt: new Date() })
        .where(eq(schema.organizations.id, tenant.organizationId));
    }
    return reply.send({ ok: true });
  });

  // Touch last activity for the session on each /auth/me to extend it
  // when used in dev (real prod should do this on every authenticated
  // request).
  void sql; void and; void gt; void isNull;
}

export { sendError };
