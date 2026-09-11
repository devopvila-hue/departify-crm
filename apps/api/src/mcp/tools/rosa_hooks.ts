/**
 * Rosa adapter for MCP tools.
 *
 * MCP tools don't have a full TenantContext, only an `McpOrgContext`
 * (see apps/api/src/mcp/auth.ts). This file exposes a tiny helper
 * that builds the minimal context the RosaService needs.
 */
import { RosaService } from '../../rosa/service.js';
import type { McpOrgContext } from '../auth.js';
import type { Database } from '@departify-crm/db';

export function rosaFromMcp(db: Database, _org: McpOrgContext): RosaService {
  return new RosaService(db);
}

/**
 * Synthetic TenantContext subset for RosaService methods.
 * RosaService only needs `organizationId` for tenant scoping.
 */
export const mcpRosaCtx = (org: McpOrgContext) => ({ organizationId: org.organizationId });
