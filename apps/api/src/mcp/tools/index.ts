/**
 * MCP tools — central registration. Call this once per MCP session.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContactTools } from './contacts.js';
import { registerCompanyTools } from './companies.js';
import { registerPipelineTools, registerDealTools } from './deals.js';
import { registerTagTools, registerNoteTools, registerTaskTools } from './tags.js';
import {
  registerSequenceTools,
  registerEnrollmentTools,
  registerSuppressionTools,
  registerMessageEventTools,
  registerActivityTools,
} from './sequences.js';
import { registerAiTools } from './ai.js';
import type { Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';

export function registerAllTools(server: McpServer, ctx: { db: Database; org: McpOrgContext }): void {
  registerContactTools(server, ctx);
  registerCompanyTools(server, ctx);
  registerPipelineTools(server, ctx);
  registerDealTools(server, ctx);
  registerTagTools(server, ctx);
  registerNoteTools(server, ctx);
  registerTaskTools(server, ctx);
  registerSequenceTools(server, ctx);
  registerEnrollmentTools(server, ctx);
  registerSuppressionTools(server, ctx);
  registerMessageEventTools(server, ctx);
  registerActivityTools(server, ctx);
  registerAiTools(server, ctx);
}
