/**
 * MCP server factory.
 *
 * Each MCP session is a new `McpServer` instance with its own
 * `StreamableHTTPServerTransport`. The session is bound to a single
 * org via the API key the caller presented, so all tool calls are
 * automatically scoped.
 *
 * We use the Node `StreamableHTTPServerTransport` (incoming-message
 * style) so it plugs straight into Fastify's `request.raw` /
 * `reply.raw` without an Hono shim.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createDb } from '@departify-crm/db';
import { config } from '../config.js';
import { resolveMcpAuth, type McpOrgContext } from './auth.js';
import { registerAllTools } from './tools/index.js';

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  org: McpOrgContext;
  db: ReturnType<typeof createDb>;
}

/** Sessions are kept in memory keyed by their session id. */
const SESSIONS = new Map<string, McpSession>();

/** Public so the route can also look up by header value. */
export function getMcpSession(sid: string): McpSession | undefined {
  return SESSIONS.get(sid);
}

/** Public for tests + graceful shutdown. */
export async function closeMcpSession(sid: string): Promise<void> {
  const s = SESSIONS.get(sid);
  if (!s) return;
  SESSIONS.delete(sid);
  try { await s.transport.close(); } catch { /* ignore */ }
  try { await s.server.close(); } catch { /* ignore */ }
  try { await s.db.$client.end?.(); } catch { /* ignore */ }
}

/**
 * Build a brand-new MCP session, authenticated and tooled-up. The
 * session is registered in the in-memory map keyed by the transport's
 * session id, so subsequent requests from the same MCP client
 * re-use the same server + transport.
 */
export async function createMcpSession(authHeader: string | undefined): Promise<McpSession | { status: 401; message: string }> {
  const db = createDb(config.DATABASE_URL);
  const org = await resolveMcpAuth(db, authHeader);
  if (!org) {
    await db.$client.end?.().catch(() => undefined);
    return { status: 401, message: 'invalid or missing API key (Authorization: Bearer <api_key>)' };
  }

  const server = new McpServer(
    {
      name: 'departify-crm',
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
      instructions: [
        'DEPARTIFY CRM — model context protocol server.',
        'All tools are scoped to the calling org via the API key used in the Authorization header.',
        'Prefer list + filter calls over fetching everything; pagination defaults are 50 per page.',
      ].join(' '),
    },
  );
  registerAllTools(server, { db, org });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // Always respond as JSON. Tests and small clients that don't
    // implement SSE are the primary consumers; full MCP clients
    // (e.g. Claude Desktop) still work over JSON responses.
    enableJsonResponse: true,
    onsessioninitialized: (sid) => {
      SESSIONS.set(sid, { server, transport, org, db });
    },
    onsessionclosed: (sid) => {
      // Best-effort cleanup. We don't await because the transport
      // is already closing.
      void closeMcpSession(sid);
    },
  });
  await server.connect(transport);
  return { server, transport, org, db };
}
