/**
 * MCP tools — tags, notes, tasks.
 *
 * Three small entities with the same CRUD shape; bundled together
 * because each is tiny on its own.
 */
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { generateId, Prefixes } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';
import { errOut, jsonOut } from './_out.js';

// ─── Tags ────────────────────────────────────────────────────────────

const ListTagsInput = z.object({});
const CreateTagInput = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const DeleteTagInput = z.object({ id: z.string() });

export function registerTagTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_tags', 'List all tags for this org.', ListTagsInput.shape, async () => {
    const items = await ctx.db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.organizationId, ctx.org.organizationId))
      .orderBy(desc(schema.tags.createdAt));
    return jsonOut({ items });
  });
  server.tool('create_tag', 'Create a tag. Returns the new id.', CreateTagInput.shape, async (a) => {
    const id = generateId(Prefixes.tag);
    await ctx.db.insert(schema.tags).values({
      id,
      organizationId: ctx.org.organizationId,
      name: a.name,
      color: a.color ?? null,
    });
    return jsonOut({ id });
  });
  server.tool('delete_tag', 'Delete a tag by id.', DeleteTagInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.tags)
      .where(and(eq(schema.tags.organizationId, ctx.org.organizationId), eq(schema.tags.id, a.id)))
      .returning({ id: schema.tags.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}

// ─── Notes ───────────────────────────────────────────────────────────

const ListNotesInput = z.object({
  subjectType: z.enum(['contact', 'company', 'deal']).optional(),
  subjectId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const CreateNoteInput = z.object({
  subjectType: z.enum(['contact', 'company', 'deal']),
  subjectId: z.string(),
  body: z.string().min(1).max(20_000),
});
const DeleteNoteInput = z.object({ id: z.string() });

export function registerNoteTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_notes', 'List notes for a contact / company / deal.', ListNotesInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.notes.organizationId, org.organizationId)];
    if (a.subjectType) conds.push(eq(schema.notes.subjectType, a.subjectType));
    if (a.subjectId) conds.push(eq(schema.notes.subjectId, a.subjectId));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.notes)
      .where(and(...conds))
      .orderBy(desc(schema.notes.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    return jsonOut({ items });
  });
  server.tool('create_note', 'Create a note attached to a contact / company / deal.', CreateNoteInput.shape, async (a) => {
    const id = generateId(Prefixes.note);
    await ctx.db.insert(schema.notes).values({
      id,
      organizationId: ctx.org.organizationId,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      body: a.body,
    });
    return jsonOut({ id });
  });
  server.tool('delete_note', 'Delete a note by id.', DeleteNoteInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.notes)
      .where(and(eq(schema.notes.organizationId, ctx.org.organizationId), eq(schema.notes.id, a.id)))
      .returning({ id: schema.notes.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────

const ListTasksInput = z.object({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  subjectType: z.enum(['contact', 'company', 'deal', 'general']).optional(),
  subjectId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const CreateTaskInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  subjectType: z.enum(['contact', 'company', 'deal', 'general']).default('general'),
  subjectId: z.string().optional(),
  ownerId: z.string().optional(),
});
const UpdateTaskInput = z.object({
  id: z.string(),
  patch: z
    .object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(20_000).nullable().optional(),
      dueAt: z.string().datetime().nullable().optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      status: z.enum(['open', 'done', 'cancelled']).optional(),
      ownerId: z.string().nullable().optional(),
    })
    .strict(),
});
const DeleteTaskInput = z.object({ id: z.string() });

export function registerTaskTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_tasks', 'List tasks with optional status and subject filters.', ListTasksInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.tasks.organizationId, org.organizationId)];
    if (a.status) conds.push(eq(schema.tasks.status, a.status));
    if (a.subjectType) conds.push(eq(schema.tasks.subjectType, a.subjectType));
    if (a.subjectId) conds.push(eq(schema.tasks.subjectId, a.subjectId));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.tasks)
      .where(and(...conds))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    return jsonOut({ items });
  });
  server.tool('create_task', 'Create a task.', CreateTaskInput.shape, async (a) => {
    const id = generateId(Prefixes.task);
    await ctx.db.insert(schema.tasks).values({
      id,
      organizationId: ctx.org.organizationId,
      title: a.title,
      description: a.description ?? null,
      dueAt: a.dueAt ? new Date(a.dueAt) : null,
      priority: a.priority,
      status: 'open',
      subjectType: a.subjectType,
      subjectId: a.subjectId ?? null,
      ownerId: a.ownerId ?? null,
    });
    return jsonOut({ id });
  });
  server.tool('update_task', 'Patch a task. Only fields in `patch` are written.', UpdateTaskInput.shape, async (a) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(a.patch)) {
      if (v === undefined) continue;
      updates[k] = k === 'dueAt' && typeof v === 'string' ? new Date(v) : v;
    }
    const res = await ctx.db
      .update(schema.tasks)
      .set(updates)
      .where(and(eq(schema.tasks.organizationId, ctx.org.organizationId), eq(schema.tasks.id, a.id)))
      .returning({ id: schema.tasks.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
  server.tool('delete_task', 'Delete a task by id.', DeleteTaskInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.tasks)
      .where(and(eq(schema.tasks.organizationId, ctx.org.organizationId), eq(schema.tasks.id, a.id)))
      .returning({ id: schema.tasks.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}

void sql;
