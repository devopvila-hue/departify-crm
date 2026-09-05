/**
 * Tenant context — a per-request object injected by the auth middleware
 * that carries the authenticated user, the active organization, and
 * the correlation id.
 *
 * Every service / repository in the API receives this context and uses
 * it to scope all DB queries with `eq(table.organizationId, ctx.organizationId)`.
 * This is the single mechanism that enforces cross-tenant isolation —
 * we never trust the client to filter.
 */
import type { Database } from '@departify-crm/db';

export interface TenantContext {
  /** The authenticated user. May be a service actor (no user). */
  userId: string | null;
  /** Always set when a request is authenticated. */
  organizationId: string;
  /** 'user' for human sessions, 'service' for API key requests. */
  actorKind: 'user' | 'service';
  /** Membership role if actor is a user, otherwise null. */
  role: 'owner' | 'admin' | 'member' | null;
  /** Request correlation id, propagated to logs and audit. */
  correlationId: string;
  db: Database;
}

export function isOwnerOrAdmin(ctx: TenantContext): boolean {
  return ctx.role === 'owner' || ctx.role === 'admin';
}
