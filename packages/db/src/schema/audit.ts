import { pgTable, text, jsonb, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { orgId } from './_helpers.js';

export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'bulk',
  'login',
  'logout',
  'integration_change',
  'sequence_change',
  'enrollment',
  'email_send',
  'webhook',
]);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    /** Nullable: service actors do not have a user. */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorKind: text('actor_kind').notNull().default('user'), // user | service
    action: auditActionEnum('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('audit_org_idx').on(t.organizationId, t.createdAt),
    resourceIdx: index('audit_resource_idx').on(t.resourceType, t.resourceId),
    actorIdx: index('audit_actor_idx').on(t.actorId),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
