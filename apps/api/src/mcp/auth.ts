/**
 * MCP auth — translate an `Authorization: Bearer <token>` header into
 * a resolved org context. We use the existing `api_keys` table (service
 * tokens) so any machine that already has an API key can also drive
 * the CRM through MCP.
 *
 * The returned context is the same shape the rest of the API uses, so
 * MCP tools can call into existing route handlers / data helpers
 * without rewriting queries.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '@departify-crm/db';
import { schema } from '@departify-crm/db';
import { sha256 } from '../lib/crypto.js';
import { config } from '../config.js';

export interface McpOrgContext {
  organizationId: string;
  /** 'user' for human sessions (rarely used by MCP), 'service' for API keys. */
  actorKind: 'user' | 'service';
  userId: string | null;
  apiKeyId: string | null;
  apiKeyScopes: string[];
}

/**
 * Resolve an MCP auth context from a Bearer token. Returns null if the
 * token is missing, malformed, revoked, or expired. The caller is
 * responsible for sending back the appropriate 401/403.
 */
export async function resolveMcpAuth(db: Database, authHeader: string | undefined): Promise<McpOrgContext | null> {
  if (!authHeader) return null;
  const m = /^Bearer\s+(\S+)$/.exec(authHeader);
  if (!m) return null;
  const token = m[1]!;
  const tokenHash = sha256(token);
  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.tokenHash, tokenHash),
        eq(schema.apiKeys.status, 'active'),
        isNull(schema.apiKeys.revokedAt),
      ),
    )
    .limit(1);
  const key = rows[0];
  if (!key) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  // Best-effort last_used_at update.
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, key.id))
    .catch(() => undefined);
  return {
    organizationId: key.organizationId,
    actorKind: 'service',
    userId: key.createdBy ?? null,
    apiKeyId: key.id,
    apiKeyScopes: (key.scopes as string[]) ?? [],
  };
}

/** The string we expect in the auth header. Public for tests. */
export const BEARER_PREFIX = 'Bearer ';

/** Suppress unused warning for the `config` import (kept for future use). */
void config;
void sql;
void gt;
