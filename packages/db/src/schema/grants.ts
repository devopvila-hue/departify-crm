/**
 * DEPARTIFY CRM — external OAuth grants (metadata only).
 *
 * Records that an organization completed a successful OAuth grant with a
 * provider. Used by the onboarding flow to flip capability cards to
 * 'ready' without ever holding a token. Tokens live in the openbot.
 */
import { pgTable, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const externalGrants = pgTable(
  'external_grants',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    provider: text('provider').notNull(),
    /** Google/Microsoft account email that completed the grant. Used for display. */
    providerEmail: text('provider_email'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProviderIdx: index('external_grants_org_provider_idx').on(t.organizationId, t.provider),
    providerCheck: check(
      'external_grants_provider_check',
      sql`${t.provider} IN ('google', 'microsoft')`,
    ),
  }),
);

export type ExternalGrant = typeof externalGrants.$inferSelect;
export type NewExternalGrant = typeof externalGrants.$inferInsert;
