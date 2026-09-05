import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import type { TenantContext } from '../tenants/context.js';

export type ActivityType =
  | 'note'
  | 'email'
  | 'call'
  | 'meeting'
  | 'task'
  | 'status_change'
  | 'deal_change'
  | 'sequence_event'
  | 'system_event';

export interface ActivityEntry {
  type: ActivityType;
  subjectType: 'contact' | 'company' | 'deal' | 'organization';
  subjectId: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(
  ctx: Pick<TenantContext, 'userId' | 'organizationId' | 'correlationId' | 'db'>,
  entry: ActivityEntry,
) {
  await ctx.db.insert(schema.activities).values({
    id: generateId(Prefixes.activity),
    organizationId: ctx.organizationId,
    type: entry.type,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    actorId: ctx.userId,
    title: entry.title,
    body: entry.body ?? null,
    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
  });
}
