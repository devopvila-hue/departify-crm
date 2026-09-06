/**
 * MCP tools — sequences, enrollments, suppressions, message_events, activities.
 */
import { z } from 'zod';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { generateId, Prefixes, type EmailEventKind } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';
import { errOut, jsonOut } from './_out.js';

// ─── Sequences ───────────────────────────────────────────────────────

const ListSequencesInput = z.object({
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
});
const GetSequenceInput = z.object({ id: z.string() });
const CreateSequenceInput = z.object({
  name: z.string().min(1).max(120),
  senderId: z.string().optional(),
  timezone: z.string().default('Europe/Madrid'),
  sendingWindowStart: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  sendingWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  steps: z
    .array(
      z.object({
        kind: z.enum(['email', 'wait', 'conditional', 'exit']),
        templateId: z.string().optional(),
        senderId: z.string().optional(),
        waitDays: z.number().int().min(0).max(365).optional(),
        ifEvent: z.enum(['opened', 'clicked', 'replied', 'bounced']).optional(),
        thenAction: z.enum(['continue', 'exit']).optional(),
      }),
    )
    .min(1)
    .max(50),
});
const UpdateSequenceInput = z.object({
  id: z.string(),
  patch: z
    .object({
      name: z.string().min(1).max(120).optional(),
      senderId: z.string().nullable().optional(),
      timezone: z.string().optional(),
      sendingWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      sendingWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      steps: z
        .array(
          z.object({
            kind: z.enum(['email', 'wait', 'conditional', 'exit']),
            templateId: z.string().optional(),
            senderId: z.string().optional(),
            waitDays: z.number().int().min(0).max(365).optional(),
            ifEvent: z.enum(['opened', 'clicked', 'replied', 'bounced']).optional(),
            thenAction: z.enum(['continue', 'exit']).optional(),
          }),
        )
        .min(1)
        .max(50)
        .optional(),
      status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
    })
    .strict(),
});
const DeleteSequenceInput = z.object({ id: z.string() });

export function registerSequenceTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_sequences', 'List email sequences for this org.', ListSequencesInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.sequences.organizationId, org.organizationId)];
    if (a.status) conds.push(eq(schema.sequences.status, a.status));
    const items = await db
      .select()
      .from(schema.sequences)
      .where(and(...conds))
      .orderBy(desc(schema.sequences.createdAt));
    return jsonOut({ items });
  });
  server.tool('get_sequence', 'Get a sequence by id, with its steps.', GetSequenceInput.shape, async (a) => {
    const rows = await ctx.db
      .select()
      .from(schema.sequences)
      .where(and(eq(schema.sequences.organizationId, ctx.org.organizationId), eq(schema.sequences.id, a.id)))
      .limit(1);
    if (!rows[0]) return errOut('NOT_FOUND');
    return jsonOut(rows[0]);
  });
  server.tool('create_sequence', 'Create a sequence with EMAIL/WAIT/CONDITIONAL/EXIT steps. Returns id.', CreateSequenceInput.shape, async (a) => {
    const id = generateId(Prefixes.sequence);
    await ctx.db.insert(schema.sequences).values({
      id,
      organizationId: ctx.org.organizationId,
      name: a.name,
      senderId: a.senderId ?? null,
      status: 'draft',
      timezone: a.timezone,
      sendingWindowStart: a.sendingWindowStart,
      sendingWindowEnd: a.sendingWindowEnd,
      steps: a.steps,
    });
    return jsonOut({ id });
  });
  server.tool('update_sequence', 'Patch a sequence (name, steps, status, window).', UpdateSequenceInput.shape, async (a) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(a.patch)) if (v !== undefined) updates[k] = v;
    const res = await ctx.db
      .update(schema.sequences)
      .set(updates)
      .where(and(eq(schema.sequences.organizationId, ctx.org.organizationId), eq(schema.sequences.id, a.id)))
      .returning({ id: schema.sequences.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
  server.tool('delete_sequence', 'Delete a sequence by id.', DeleteSequenceInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.sequences)
      .where(and(eq(schema.sequences.organizationId, ctx.org.organizationId), eq(schema.sequences.id, a.id)))
      .returning({ id: schema.sequences.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}

// ─── Enrollments ────────────────────────────────────────────────────

const EnrollInput = z.object({ sequenceId: z.string(), contactId: z.string() });
const ListEnrollmentsInput = z.object({ sequenceId: z.string() });
const ControlEnrollmentInput = z.object({
  id: z.string(),
  action: z.enum(['pause', 'resume', 'exit']),
  reason: z.string().min(1).max(200).optional(),
});

export function registerEnrollmentTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('enroll_contact_in_sequence', 'Enroll a contact in a sequence. Idempotent: returns the existing enrollment id if already active/paused.', EnrollInput.shape, async (a) => {
    const { db, org } = ctx;
    const seqRows = await db
      .select()
      .from(schema.sequences)
      .where(and(eq(schema.sequences.organizationId, org.organizationId), eq(schema.sequences.id, a.sequenceId)))
      .limit(1);
    if (!seqRows[0]) return errOut('SEQUENCE_NOT_FOUND');
    const contactRows = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, org.organizationId), eq(schema.contacts.id, a.contactId)))
      .limit(1);
    if (!contactRows[0]) return errOut('CONTACT_NOT_FOUND');

    const existing = await db
      .select()
      .from(schema.sequenceEnrollments)
      .where(and(
        eq(schema.sequenceEnrollments.organizationId, org.organizationId),
        eq(schema.sequenceEnrollments.sequenceId, a.sequenceId),
        eq(schema.sequenceEnrollments.contactId, a.contactId),
      ))
      .limit(1);
    if (existing[0] && (existing[0].status === 'active' || existing[0].status === 'paused')) {
      return jsonOut({ id: existing[0].id, alreadyEnrolled: true });
    }
    const id = generateId(Prefixes.sequenceEnrollment);
    const firstStep = (seqRows[0].steps as Array<{ kind: string; waitDays?: number }>)[0];
    const waitMs = firstStep?.kind === 'wait' ? (firstStep.waitDays ?? 0) * 24 * 60 * 60 * 1000 : 0;
    await db.insert(schema.sequenceEnrollments).values({
      id,
      organizationId: org.organizationId,
      sequenceId: a.sequenceId,
      contactId: a.contactId,
      currentStep: 0,
      nextActionAt: new Date(Date.now() + waitMs),
      status: 'active',
    });
    return jsonOut({ id });
  });
  server.tool('list_sequence_enrollments', 'List enrollments for a sequence.', ListEnrollmentsInput.shape, async (a) => {
    const items = await ctx.db
      .select()
      .from(schema.sequenceEnrollments)
      .where(and(
        eq(schema.sequenceEnrollments.organizationId, ctx.org.organizationId),
        eq(schema.sequenceEnrollments.sequenceId, a.sequenceId),
      ))
      .orderBy(asc(schema.sequenceEnrollments.currentStep));
    return jsonOut({ items });
  });
  server.tool('control_enrollment', 'Pause, resume, or exit a single enrollment.', ControlEnrollmentInput.shape, async (a) => {
    if (a.action === 'exit') {
      const res = await ctx.db
        .update(schema.sequenceEnrollments)
        .set({ status: 'exited', exitReason: a.reason ?? 'mcp_exit', completedAt: new Date() })
        .where(and(
          eq(schema.sequenceEnrollments.organizationId, ctx.org.organizationId),
          eq(schema.sequenceEnrollments.id, a.id),
        ))
        .returning({ id: schema.sequenceEnrollments.id });
      if (!res.length) return errOut('NOT_FOUND');
      return jsonOut({ ok: true, id: res[0]!.id, status: 'exited' });
    }
    const status = a.action === 'pause' ? 'paused' : 'active';
    const res = await ctx.db
      .update(schema.sequenceEnrollments)
      .set({ status })
      .where(and(
        eq(schema.sequenceEnrollments.organizationId, ctx.org.organizationId),
        eq(schema.sequenceEnrollments.id, a.id),
      ))
      .returning({ id: schema.sequenceEnrollments.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id, status });
  });
}

// ─── Suppressions ───────────────────────────────────────────────────

const ListSuppressionsInput = z.object({
  reason: z.enum(['unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const AddSuppressionInput = z.object({
  email: z.string().email(),
  reason: z.enum(['unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid']).default('manual'),
  source: z.string().max(120).optional(),
});
const RemoveSuppressionInput = z.object({ email: z.string().email() });

export function registerSuppressionTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_suppressions', 'List suppression entries for this org.', ListSuppressionsInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.suppressions.organizationId, org.organizationId)];
    if (a.reason) conds.push(eq(schema.suppressions.reason, a.reason));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.suppressions)
      .where(and(...conds))
      .orderBy(desc(schema.suppressions.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    return jsonOut({ items });
  });
  server.tool('add_suppression', 'Add an email to the suppression list. Idempotent (upsert).', AddSuppressionInput.shape, async (a) => {
    const id = generateId(Prefixes.suppression);
    await ctx.db
      .insert(schema.suppressions)
      .values({
        id,
        organizationId: ctx.org.organizationId,
        email: a.email,
        reason: a.reason,
        source: a.source ?? 'mcp',
      })
      .onConflictDoUpdate({
        target: [schema.suppressions.organizationId, schema.suppressions.email],
        set: { reason: a.reason, source: a.source ?? 'mcp' },
      });
    return jsonOut({ id });
  });
  server.tool('remove_suppression', 'Remove an email from the suppression list.', RemoveSuppressionInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.suppressions)
      .where(and(
        eq(schema.suppressions.organizationId, ctx.org.organizationId),
        eq(schema.suppressions.email, a.email),
      ))
      .returning({ email: schema.suppressions.email });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, email: res[0]!.email });
  });
}

// ─── Message events ─────────────────────────────────────────────────

const ListMessageEventsInput = z.object({
  contactId: z.string().optional(),
  enrollmentId: z.string().optional(),
  kind: z.enum(['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'opened', 'clicked', 'unsubscribed']).optional(),
  since: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export function registerMessageEventTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_message_events', 'List message events (sent / delivered / opened / etc.) with filters.', ListMessageEventsInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.messageEvents.organizationId, org.organizationId)];
    if (a.contactId) conds.push(eq(schema.messageEvents.contactId, a.contactId));
    if (a.enrollmentId) conds.push(eq(schema.messageEvents.enrollmentId, a.enrollmentId));
    if (a.kind) conds.push(eq(schema.messageEvents.kind, a.kind as EmailEventKind));
    if (a.since) conds.push(gte(schema.messageEvents.createdAt, new Date(a.since)));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.messageEvents)
      .where(and(...conds))
      .orderBy(desc(schema.messageEvents.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    const totalRow = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.messageEvents)
      .where(and(...conds));
    return jsonOut({ items, total: totalRow[0]?.c ?? 0 });
  });
}

// ─── Activities ─────────────────────────────────────────────────────

const ListActivitiesInput = z.object({
  subjectType: z.enum(['contact', 'company', 'deal', 'organization']).optional(),
  subjectId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const CreateActivityInput = z.object({
  type: z.enum(['note', 'email', 'call', 'meeting', 'task', 'status_change', 'deal_change', 'sequence_event', 'system_event']),
  subjectType: z.enum(['contact', 'company', 'deal', 'organization']),
  subjectId: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function registerActivityTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_activities', 'List activities for a contact / company / deal.', ListActivitiesInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.activities.organizationId, org.organizationId)];
    if (a.subjectType) conds.push(eq(schema.activities.subjectType, a.subjectType));
    if (a.subjectId) conds.push(eq(schema.activities.subjectId, a.subjectId));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.activities)
      .where(and(...conds))
      .orderBy(desc(schema.activities.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    return jsonOut({ items });
  });
  server.tool('create_activity', 'Create an activity (note, call, meeting, etc.) linked to a contact / company / deal.', CreateActivityInput.shape, async (a) => {
    const id = generateId(Prefixes.activity);
    await ctx.db.insert(schema.activities).values({
      id,
      organizationId: ctx.org.organizationId,
      type: a.type,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      title: a.title,
      body: a.body ?? null,
      metadata: a.metadata ?? {},
    });
    return jsonOut({ id });
  });
}
