/**
 * Relationship guard.
 *
 * Scoping a row's own SELECT/UPDATE by organization_id is not enough:
 * a write that *points* at another row (task.subject_id,
 * contact.company_id, deal.company_id, deal_contacts.contact_id) can
 * still smuggle a foreign id into this tenant's data. Every such write
 * resolves the target through here first, so a relationship can never
 * cross an organization boundary.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { badRequest } from '../errors.js';
import type { TenantContext } from '../tenants/context.js';

const tables = {
  contact: schema.contacts,
  company: schema.companies,
  deal: schema.deals,
} as const;

export type OwnedKind = keyof typeof tables;

/**
 * Rejects with 400 unless `id` names a row of `kind` inside the
 * caller's organization. A foreign id is indistinguishable from a
 * nonexistent one, so nothing about other tenants leaks.
 */
export async function assertOwned(tenant: TenantContext, kind: OwnedKind, id: string): Promise<void> {
  const table = tables[kind];
  const rows = await tenant.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, tenant.organizationId), eq(table.id, id)))
    .limit(1);
  if (!rows.length) throw badRequest(`Unknown ${kind}: ${id}`);
}

/** Same contract as `assertOwned`, for a batch of ids of one kind. */
export async function assertAllOwned(tenant: TenantContext, kind: OwnedKind, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const table = tables[kind];
  const unique = [...new Set(ids)];
  const rows = await tenant.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, tenant.organizationId), inArray(table.id, unique)));
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    throw badRequest(`Unknown ${kind}: ${unique.filter((i) => !found.has(i)).join(', ')}`);
  }
}
