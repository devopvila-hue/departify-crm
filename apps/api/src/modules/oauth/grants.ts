/**
 * DEPARTIFY CRM — external OAuth grants registry (Google + Microsoft).
 *
 * Scope recording flow:
 *   1. User logs in via Supabase OAuth (existing flow — unchanged).
 *   2. SPA calls POST /api/v1/auth/oauth/:provider/register-scopes with
 *      the scopes that Supabase returned. This endpoint is called with the
 *      user's session cookie so it is authenticated to the correct org.
 *   3. We upsert an external_grants row with scopes + provider_email.
 *   4. Onboarding cards (drive/calendar/mail) become 'ready' via the
 *      existing /onboarding/capability-status read path — which already
 *      reads external_grants and flips cards accordingly.
 *
 * What is NOT here:
 *   - Token storage. Tokens stay in Supabase/openbot.
 *   - OAuth round-trip initiation. That is Supabase's job.
 *   - Revocation. A future /auth/oauth/:provider/revoke endpoint can do it.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { requireAuth } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

/** Canonical capability scopes per provider. */
export const GOOGLE_CAPABILITY_SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  mail: 'https://www.googleapis.com/auth/gmail.readonly',
} as const;

export const MICROSOFT_CAPABILITY_SCOPES = {
  drive: 'Files.Read',
  calendar: 'Calendars.Read',
  mail: 'Mail.Read',
} as const;

const ProviderSchema = z.enum(['google', 'microsoft']);

const RegisterScopesBody = z.object({
  /** Array of scope strings the OAuth provider returned. */
  scopes: z.array(z.string()).min(1),
  /**
   * Provider account email (e.g. alice@gmail.com). If omitted we
   * skip the email field — the grant is still recorded.
   */
  providerEmail: z.string().email().optional(),
});

/**
 * Map granted scopes to capability keys.
 * Returns the subset of ['drive', 'calendar', 'mail'] that the granted
 * scopes cover.
 */
export function scopesToCapabilities(
  provider: 'google' | 'microsoft',
  grantedScopes: string[],
): ('drive' | 'calendar' | 'mail')[] {
  const caps: ('drive' | 'calendar' | 'mail')[] = [];
  const scopeSet = new Set(grantedScopes.map((s) => s.toLowerCase()));

  const required = provider === 'google' ? GOOGLE_CAPABILITY_SCOPES : MICROSOFT_CAPABILITY_SCOPES;

  for (const [cap, scope] of Object.entries(required)) {
    if (scopeSet.has(scope.toLowerCase())) {
      caps.push(cap as 'drive' | 'calendar' | 'mail');
    }
  }
  return caps;
}

export async function grantsRoutes(app: FastifyInstance) {
  /**
   * POST /api/v1/auth/oauth/:provider/register-scopes
   *
   * Called by the SPA after a Supabase OAuth callback succeeds. Records
   * the granted scopes and flips the corresponding onboarding capability
   * cards to 'ready'.
   *
   * Auth: session cookie (requireAuth). The SPA calls this after
   * the user completes the Supabase OAuth flow so we know which org
   * to attach the grant to.
   *
   * Idempotent: re-calling with the same (org, provider) overwrites
   * scopes and updates last_seen_at but does not create a duplicate.
   */
  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/auth/oauth/:provider/register-scopes',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const params = req.params as { provider: string };
      const parsedProvider = ProviderSchema.safeParse(params.provider);
      if (!parsedProvider.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid provider. Must be google or microsoft.',
        });
      }
      const provider = parsedProvider.data;

      const parsedBody = RegisterScopesBody.safeParse(req.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid body',
          details: parsedBody.error.flatten(),
        });
      }
      const { scopes, providerEmail } = parsedBody.data;

      const tenant = req.tenant!;
      const orgId = tenant.organizationId;

      const capabilities = scopesToCapabilities(provider, scopes);

      // Upsert external_grants row. The select-then-upsert pattern avoids
      // a unique-constraint requirement on (org_id, provider) — the index
      // is regular, not unique (same pattern as the OAuth routes).
      const existing = await tenant.db
        .select({ id: schema.externalGrants.id })
        .from(schema.externalGrants)
        .where(eq(schema.externalGrants.organizationId, orgId))
        .limit(1);

      if (existing.length) {
        await tenant.db
          .update(schema.externalGrants)
          .set({
            scopes,
            providerEmail: providerEmail ?? null,
            lastSeenAt: new Date(),
          })
          .where(eq(schema.externalGrants.id, existing[0]!.id));
      } else {
        await tenant.db.insert(schema.externalGrants).values({
          id: generateId(Prefixes.audit),
          organizationId: orgId,
          provider,
          scopes,
          providerEmail: providerEmail ?? null,
        });
      }

      // Audit the event (non-blocking for the response).
      void audit(tenant.db, tenant, {
        action: 'integration_change',
        resourceType: 'oauth_grant',
        metadata: { event: 'register_scopes', provider, scopes, capabilities, orgId },
      });

      return reply.send({
        ok: true,
        provider,
        capabilities,
        scopes,
      });
    },
  );

  /**
   * GET /api/v1/auth/oauth/grants
   *
   * Returns all external grants for the current org with their derived
   * capabilities. Used by the onboarding UI to show
   * "Connected as alice@gmail.com" and which cards are ready.
   */
  app.get('/auth/oauth/grants', { preHandler: [requireAuth] }, async (req) => {
    const tenant = req.tenant!;

    const grants = await tenant.db
      .select({
        id: schema.externalGrants.id,
        provider: schema.externalGrants.provider,
        providerEmail: schema.externalGrants.providerEmail,
        scopes: schema.externalGrants.scopes,
        lastSeenAt: schema.externalGrants.lastSeenAt,
        grantedAt: schema.externalGrants.grantedAt,
      })
      .from(schema.externalGrants)
      .where(eq(schema.externalGrants.organizationId, tenant.organizationId));

    return grants.map((g) => ({
      id: g.id,
      provider: g.provider,
      providerEmail: g.providerEmail,
      scopes: g.scopes ?? [],
      capabilities: scopesToCapabilities(g.provider as 'google' | 'microsoft', g.scopes ?? []),
      lastSeenAt: g.lastSeenAt?.toISOString() ?? null,
      grantedAt: g.grantedAt?.toISOString() ?? null,
    }));
  });
}
