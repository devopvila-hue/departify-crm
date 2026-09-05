import { schema, type Database } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import type { TenantContext } from '../tenants/context.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'bulk'
  | 'login'
  | 'logout'
  | 'integration_change'
  | 'sequence_change'
  | 'enrollment'
  | 'email_send'
  | 'webhook';

export interface AuditEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(db: Database, ctx: Pick<TenantContext, 'userId' | 'organizationId' | 'actorKind' | 'correlationId'>, entry: AuditEntry) {
  await db.insert(schema.auditEvents).values({
    id: generateId(Prefixes.audit),
    organizationId: ctx.organizationId,
    actorId: ctx.userId ?? null,
    actorKind: ctx.actorKind,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    correlationId: ctx.correlationId,
    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
  });
}
