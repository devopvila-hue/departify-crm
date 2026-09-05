/**
 * Lightweight OpenAPI 3.1 generator. We don't pull in a heavy library
 * — every route registers a small description and we assemble a single
 * document at boot. The goal is that the OpenAPI output reflects the
 * real surface so DEPARTIFY can build tooling on top of it.
 */
import type { FastifyInstance } from 'fastify';

export interface OpenAPIDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description?: string }>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  paths: Record<string, Record<string, unknown>>;
  tags: Array<{ name: string; description?: string }>;
}

export function buildOpenAPI(opts: { app: FastifyInstance; baseUrl: string }): OpenAPIDocument {
  const paths: OpenAPIDocument['paths'] = {};
  for (const route of opts.app.printRoutes({ commonPrefix: false }).split('\n')) {
    if (!route.trim()) continue;
    // printed format: "method (url) -> handler"
    const m = route.match(/^(\S+)\s+\(([^)]+)\)\s+->/);
    if (!m) continue;
    const method = m[1]!.toLowerCase();
    const url = m[2]!;
    const item = describeRoute(method, url);
    paths[url] = { ...(paths[url] ?? {}), [method]: item };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'DEPARTIFY CRM API',
      version: '0.1.0',
      description:
        'Operational CRM API. Multi-tenant. Every business route is scoped to the caller’s organization. ' +
        'Auth: cookie session for human users, Bearer API key for service-to-service (DEPARTIFY) calls.',
    },
    servers: [{ url: opts.baseUrl, description: 'default' }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'sid' },
        bearerApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: ['VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'INTEGRATION_NOT_CONFIGURED', 'SUPPRESSED', 'INTERNAL'] },
            message: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
            correlationId: { type: 'string' },
          },
        },
        Page: {
          type: 'object',
          properties: {
            items: { type: 'array', items: {} },
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
    paths,
    tags: [
      { name: 'auth', description: 'Signup, login, logout, me' },
      { name: 'contacts', description: 'Contacts CRUD, search, timeline' },
      { name: 'companies', description: 'Companies CRUD' },
      { name: 'pipelines', description: 'Pipelines, stages, kanban view' },
      { name: 'deals', description: 'Deals CRUD, move between stages' },
      { name: 'tags', description: 'Tag definitions and bulk assign' },
      { name: 'notes', description: 'Notes attached to contacts / companies / deals' },
      { name: 'tasks', description: 'Tasks' },
      { name: 'custom-fields', description: 'Custom field definitions' },
      { name: 'search', description: 'Global search' },
      { name: 'attention', description: 'Operational home data' },
      { name: 'service-keys', description: 'Service API keys for DEPARTIFY' },
      { name: 'health' },
    ],
  };
}

function describeRoute(method: string, url: string): Record<string, unknown> {
  const cleaned = url.replace(/:([a-zA-Z_]+)/g, '{$1}');
  return {
    summary: `${method.toUpperCase()} ${cleaned}`,
    tags: [tagFor(cleaned)],
    security: [{ sessionCookie: [] }, { bearerApiKey: [] }],
    responses: {
      '200': { description: 'ok' },
      '400': { description: 'validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      '401': { description: 'unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      '403': { description: 'forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      '404': { description: 'not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      '409': { description: 'conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
    },
  };
}

function tagFor(url: string): string {
  if (url.startsWith('/api/v1/auth')) return 'auth';
  if (url.startsWith('/api/v1/contacts')) return 'contacts';
  if (url.startsWith('/api/v1/companies')) return 'companies';
  if (url.startsWith('/api/v1/pipelines')) return 'pipelines';
  if (url.startsWith('/api/v1/deals')) return 'deals';
  if (url.startsWith('/api/v1/tags')) return 'tags';
  if (url.startsWith('/api/v1/notes')) return 'notes';
  if (url.startsWith('/api/v1/tasks')) return 'tasks';
  if (url.startsWith('/api/v1/custom-fields')) return 'custom-fields';
  if (url.startsWith('/api/v1/search')) return 'search';
  if (url.startsWith('/api/v1/attention')) return 'attention';
  if (url.startsWith('/api/v1/service-keys')) return 'service-keys';
  if (url.startsWith('/health') || url.startsWith('/ready')) return 'health';
  return 'misc';
}
