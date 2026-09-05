/**
 * Email / sequences schema (scaffold).
 *
 * Phase 5+ work will fill in: senders, templates, sequences, enrollments,
 * suppression, message events, webhooks. This file declares the tables now
 * so the rest of the system can reference them without later migrations
 * on the existing core entities.
 */
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgId } from './_helpers.js';
import { contacts } from './contacts.js';

export const emailProviderEnum = pgEnum('email_provider', ['resend', 'brevo', 'smtp', 'fake']);
export const senderStatusEnum = pgEnum('sender_status', ['active', 'paused', 'pending', 'disabled']);

export const emailSenders = pgTable(
  'email_senders',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    provider: emailProviderEnum('provider').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    replyTo: text('reply_to'),
    /** Encrypted JSON. Never returned to the client after creation. */
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    status: senderStatusEnum('status').notNull().default('pending'),
    dailyLimit: integer('daily_limit').notNull().default(500),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEmailUq: uniqueIndex('senders_org_email_uq').on(t.organizationId, t.email),
  }),
);

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    senderId: text('sender_id').references(() => emailSenders.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('templates_org_idx').on(t.organizationId),
  }),
);

export const sequenceStatusEnum = pgEnum('sequence_status', ['draft', 'active', 'paused', 'archived']);

export const sequences = pgTable(
  'sequences',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    senderId: text('sender_id').references(() => emailSenders.id, { onDelete: 'set null' }),
    status: sequenceStatusEnum('status').notNull().default('draft'),
    timezone: text('timezone').notNull().default('Europe/Madrid'),
    sendingWindowStart: text('sending_window_start').notNull().default('09:00'),
    sendingWindowEnd: text('sending_window_end').notNull().default('18:00'),
    steps: jsonb('steps')
      .$type<Array<{ kind: 'email' | 'wait'; templateId?: string; waitDays?: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('sequences_org_idx').on(t.organizationId),
  }),
);

export const sequenceEnrollmentStatusEnum = pgEnum('sequence_enrollment_status', [
  'active',
  'paused',
  'completed',
  'exited',
]);

export const sequenceEnrollments = pgTable(
  'sequence_enrollments',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    sequenceId: text('sequence_id').notNull().references(() => sequences.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    currentStep: integer('current_step').notNull().default(0),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    status: sequenceEnrollmentStatusEnum('status').notNull().default('active'),
    exitReason: text('exit_reason'),
    enrolledAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    seqContactUq: uniqueIndex('enrollments_seq_contact_uq').on(t.sequenceId, t.contactId),
    nextIdx: index('enrollments_next_idx').on(t.nextActionAt).where(sql`status = 'active'`),
  }),
);

export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'unsubscribed',
  'hard_bounce',
  'complaint',
  'manual',
  'invalid',
]);

export const suppressions = pgTable(
  'suppressions',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    email: text('email').notNull(),
    reason: suppressionReasonEnum('reason').notNull(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEmailUq: uniqueIndex('suppressions_org_email_uq').on(t.organizationId, t.email),
  }),
);

export const messageEventKindEnum = pgEnum('message_event_kind', [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'opened',
  'clicked',
  'unsubscribed',
]);

export const messageEvents = pgTable(
  'message_events',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    enrollmentId: text('enrollment_id').references(() => sequenceEnrollments.id, {
      onDelete: 'set null',
    }),
    contactId: text('contact_id').notNull(),
    senderId: text('sender_id').references(() => emailSenders.id, { onDelete: 'set null' }),
    provider: emailProviderEnum('provider').notNull(),
    providerMessageId: text('provider_message_id'),
    kind: messageEventKindEnum('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index('message_events_contact_idx').on(t.contactId, t.createdAt),
    orgIdx: index('message_events_org_idx').on(t.organizationId, t.createdAt),
    providerMsgIdx: index('message_events_provider_msg_idx').on(t.providerMessageId),
  }),
);
