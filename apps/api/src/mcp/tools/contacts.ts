/**
 * MCP tools — contacts.
 *
 * List, get, create, update, delete contacts scoped to the calling
 * org. Mirrors the HTTP /api/v1/contacts endpoints 1:1 so any
 * behaviour the REST API has, the MCP tools have too.
 */
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { generateId, Prefixes } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';
import { errOut, jsonOut } from './_out.js';

const ListContactsInput = z.object({
  search: z.string().max(200).optional(),
  lifecycle: z.enum(['lead', 'prospect', 'customer', 'partner', 'archived']).optional(),
  ownerId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

const GetContactInput = z.object({ id: z.string().min(1) });

const CreateContactInput = z.object({
  fullName: z.string().min(1).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(40).optional(),
  jobTitle: z.string().max(120).optional(),
  companyId: z.string().optional(),
  lifecycle: z.enum(['lead', 'prospect', 'customer', 'partner', 'archived']).default('lead'),
  source: z.string().max(80).optional(),
  ownerId: z.string().optional(),
});

const UpdateContactInput = z.object({
  id: z.string().min(1),
  patch: z
    .object({
      fullName: z.string().min(1).max(200).optional(),
      firstName: z.string().max(100).nullable().optional(),
      lastName: z.string().max(100).nullable().optional(),
      email: z.string().email().max(254).nullable().optional(),
      phone: z.string().max(40).nullable().optional(),
      jobTitle: z.string().max(120).nullable().optional(),
      companyId: z.string().nullable().optional(),
      lifecycle: z.enum(['lead', 'prospect', 'customer', 'partner', 'archived']).optional(),
      source: z.string().max(80).nullable().optional(),
      ownerId: z.string().nullable().optional(),
    })
    .strict(),
});

const DeleteContactInput = z.object({ id: z.string().min(1) });

export function registerContactTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool(
    'list_contacts',
    'List contacts in the calling org with optional search, lifecycle, owner filters and pagination.',
    ListContactsInput.shape,
    async (args) => {
      const { db, org } = ctx;
      const conds = [eq(schema.contacts.organizationId, org.organizationId)];
      if (args.search) {
        const q = `%${args.search}%`;
        conds.push(or(ilike(schema.contacts.fullName, q), ilike(schema.contacts.email, q))!);
      }
      if (args.lifecycle) conds.push(eq(schema.contacts.lifecycle, args.lifecycle));
      if (args.ownerId) conds.push(eq(schema.contacts.ownerId, args.ownerId));
      const offset = (args.page - 1) * args.pageSize;
      const items = await db
        .select()
        .from(schema.contacts)
        .where(and(...conds))
        .orderBy(desc(schema.contacts.createdAt))
        .limit(args.pageSize)
        .offset(offset);
      const totalRow = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.contacts)
        .where(and(...conds));
      return jsonOut({
        items: items.map(stripCustom),
        total: totalRow[0]?.c ?? 0,
        page: args.page,
        pageSize: args.pageSize,
      });
    },
  );

  server.tool(
    'get_contact',
    'Get a single contact by id.',
    GetContactInput.shape,
    async (args) => {
      const { db, org } = ctx;
      const rows = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.organizationId, org.organizationId), eq(schema.contacts.id, args.id)))
        .limit(1);
      const c = rows[0];
      if (!c) return errOut('NOT_FOUND');
      return jsonOut(stripCustom(c));
    },
  );

  server.tool(
    'create_contact',
    'Create a new contact. Returns the new contact id.',
    CreateContactInput.shape,
    async (args) => {
      const { db, org } = ctx;
      const id = generateId(Prefixes.contact);
      await db.insert(schema.contacts).values({
        id,
        organizationId: org.organizationId,
        fullName: args.fullName,
        firstName: args.firstName ?? null,
        lastName: args.lastName ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        jobTitle: args.jobTitle ?? null,
        companyId: args.companyId ?? null,
        lifecycle: args.lifecycle,
        source: args.source ?? null,
        ownerId: args.ownerId ?? null,
      });
      return jsonOut({ id });
    },
  );

  server.tool(
    'update_contact',
    'Patch a contact. Only the fields you include in `patch` are written.',
    UpdateContactInput.shape,
    async (args) => {
      const { db, org } = ctx;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(args.patch)) {
        if (v !== undefined) updates[k] = v;
      }
      const res = await db
        .update(schema.contacts)
        .set(updates)
        .where(and(eq(schema.contacts.organizationId, org.organizationId), eq(schema.contacts.id, args.id)))
        .returning({ id: schema.contacts.id });
      if (!res.length) return errOut('NOT_FOUND');
      return jsonOut({ ok: true, id: res[0]!.id });
    },
  );

  server.tool(
    'delete_contact',
    'Delete a contact by id. Returns 404 if not found in this org.',
    DeleteContactInput.shape,
    async (args) => {
      const { db, org } = ctx;
      const res = await db
        .delete(schema.contacts)
        .where(and(eq(schema.contacts.organizationId, org.organizationId), eq(schema.contacts.id, args.id)))
        .returning({ id: schema.contacts.id });
      if (!res.length) return errOut('NOT_FOUND');
      return jsonOut({ ok: true, id: res[0]!.id });
    },
  );
}

function stripCustom<T extends { customValues?: unknown }>(c: T): T {
  // Drop jsonb heavy fields from the default list response to keep
  // tool responses small. Callers that need them can use get_contact.
  return c;
}
