/**
 * MCP HTTP routes — mounts the Streamable HTTP endpoint at `/mcp`.
 *
 * Sessions are sticky: once an `initialize` request comes in and the
 * transport assigns a session id, all subsequent requests carrying
 * that id (via `mcp-session-id` header) re-use the same McpServer +
 * transport pair. This is required by the MCP spec — the transport
 * keeps per-session state.
 */
import type { FastifyInstance } from 'fastify';
import { createMcpSession, getMcpSession } from './server.js';

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): Promise<void> => {
    const sid = (req.headers['mcp-session-id'] as string | undefined) ?? '';
    let session = sid ? getMcpSession(sid) : undefined;
    if (!session) {
      // New session (or unknown session id — the transport will
      // either treat this as a new init or return a clean error).
      const created = await createMcpSession(req.headers.authorization);
      if ('status' in created) {
        reply.code(created.status).send({ error: created.message });
        return;
      }
      session = created;
    }
    try {
      await session.transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ err }, 'mcp transport handleRequest failed');
      if (!reply.sent) {
        reply.code(500).send({ error: 'mcp transport error' });
      }
    }
  };

  app.post('/mcp', handler);
  app.get('/mcp', handler);
  app.delete('/mcp', handler);
}
