import { pgTable, text, integer, timestamp, index, uniqueIndex, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { orgId } from './_helpers.js';

export const customFieldEntityEnum = pgEnum('custom_field_entity', ['contact', 'company', 'deal']);
export const customFieldTypeEnum = pgEnum('custom_field_type', [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multi_select',
  'url',
  'email',
]);

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    entity: customFieldEntityEnum('entity').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: customFieldTypeEnum('type').notNull(),
    options: jsonb('options').$type<string[]>().notNull().default([]),
    required: integer('required').notNull().default(0),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEntityKeyUq: uniqueIndex('cfdef_org_entity_key_uq').on(t.organizationId, t.entity, t.key),
    orgEntityIdx: index('cfdef_org_entity_idx').on(t.organizationId, t.entity),
  }),
);

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
