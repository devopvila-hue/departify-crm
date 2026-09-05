/**
 * Lists/segments, integration credentials, and API key tables — declared
 * now so future phases can plug in without re-migrating the core entities.
 */
import { pgTable, text, jsonb, index, uniqueIndex, pgEnum, timestamp } from 'drizzle-orm/pg-core';
import { orgId } from './_helpers.js';
import { users } from './users.js';

export const listKindEnum = pgEnum('list_kind', ['static', 'dynamic']);

export const lists = pgTable(
  'lists',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    kind: listKindEnum('kind').notNull(),
    /** For dynamic lists: serialized FilterNode. */
    definition: jsonb('definition').$type<Record<string, unknown> | null>(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgNameUq: uniqueIndex('lists_org_name_uq').on(t.organizationId, t.name),
  }),
);

export const listContacts = pgTable(
  'list_contacts',
  {
    organizationId: orgId(),
    listId: text('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('list_contacts_pk').on(t.listId, t.contactId),
    contactIdx: index('list_contacts_contact_idx').on(t.contactId),
  }),
);

export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked']);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    /** SHA-256 of the secret. The secret itself is shown once at creation. */
    tokenHash: text('token_hash').notNull(),
    /** Short prefix to help humans identify the key in logs. */
    prefix: text('prefix').notNull(),
    /** Scopes like "service:read" or "service:write". */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: apiKeyStatusEnum('status').notNull().default('active'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tokenUq: uniqueIndex('api_keys_token_uq').on(t.tokenHash),
    orgIdx: index('api_keys_org_idx').on(t.organizationId),
  }),
);
