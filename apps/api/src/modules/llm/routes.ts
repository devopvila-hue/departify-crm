/**
 * LLM routes — minimal chat endpoint for testing the LLM client.
 *
 * Real LLM traffic in the CRM happens through MCP tools (Sprint 6) and
 * background jobs (CSV import, contact enrichment, …). This endpoint
 * is just to verify the wiring works.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { createLlmClient, LlmError } from '@departify-crm/llm';
import { config } from '../../config.js';
import { badRequest } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';

const ChatBody = z.object({
  system: z.string().max(8_000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(50),
  maxTokens: z.number().int().min(1).max(8192).default(512),
  temperature: z.number().min(0).max(2).optional(),
  model: z.string().optional(),
});

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  // Auth + admin role: the LLM is a privileged capability and we want
  // a clear audit trail of who called it.
  app.post(
    '/llm/chat',
    { preHandler: [requireRole('admin')] },
    async (req, reply) => {
      if (!config.LLM_API_KEY) {
        return reply.code(503).send({
          code: 'LLM_NOT_CONFIGURED',
          message: 'LLM_API_KEY no está configurada. Define LLM_API_KEY y, opcionalmente, LLM_BASE_URL y LLM_MODEL.',
        });
      }
      const body = ChatBody.parse(req.body);
      const client = createLlmClient({
        provider: config.LLM_PROVIDER,
        apiKey: config.LLM_API_KEY,
        baseUrl: config.LLM_BASE_URL,
        model: body.model ?? config.LLM_MODEL,
        timeoutMs: config.LLM_TIMEOUT_MS,
        maxRetries: config.LLM_MAX_RETRIES,
      });
      try {
        const res = await client.chat({
          model: body.model ?? config.LLM_MODEL,
          system: body.system,
          messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: body.maxTokens,
          temperature: body.temperature,
        });
        return {
          id: res.id,
          model: res.model,
          stop_reason: res.stop_reason,
          content: res.content,
          usage: res.usage,
        };
      } catch (err) {
        if (err instanceof LlmError) {
          req.log.warn({ kind: err.kind, status: err.status }, 'LLM call failed');
          if (err.kind === 'invalid_request') throw badRequest(err.message);
          return reply.code(err.retryable ? 503 : 500).send({
            code: err.kind.toUpperCase(),
            message: err.message,
            retryable: err.retryable,
          });
        }
        throw err;
      }
    },
  );
  // Suppress unused warnings for re-exports that some templates use.
  void badRequest;
}
