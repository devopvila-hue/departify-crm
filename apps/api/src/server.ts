import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import { sendError } from './errors.js';
import { tenantPlugin } from './tenants/plugin.js';
import { authRoutes } from './modules/auth/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { companyRoutes } from './modules/companies/routes.js';
import { pipelineRoutes } from './modules/pipelines/routes.js';
import { dealRoutes } from './modules/deals/routes.js';
import { tagRoutes } from './modules/tags/routes.js';
import { noteRoutes } from './modules/notes/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { customFieldRoutes } from './modules/custom-fields/routes.js';
import { attentionRoutes } from './modules/attention/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { serviceKeyRoutes } from './modules/service-keys/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { buildOpenAPI } from './openapi/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
    },
    disableRequestLogging: config.NODE_ENV === 'test',
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_DEFAULT_MAX,
    timeWindow: config.RATE_LIMIT_DEFAULT_WINDOW,
    keyGenerator: (req) => req.ip,
  });
  await app.register(tenantPlugin);

  app.setErrorHandler(sendError);

  // --- OpenAPI doc route ---------------------------------------------
  app.get('/openapi.json', async () => buildOpenAPI({ app, baseUrl: config.APP_BASE_URL }));
  app.get('/docs', async (_req, reply) => {
    reply.type('text/html').send(swaggerHtml(config.APP_BASE_URL));
  });

  // --- Health ---------------------------------------------------------
  await app.register(healthRoutes);

  // --- API v1 ---------------------------------------------------------
  await app.register(async (v1) => {
    await v1.register(authRoutes, { prefix: '/api/v1' });
    await v1.register(contactRoutes, { prefix: '/api/v1' });
    await v1.register(companyRoutes, { prefix: '/api/v1' });
    await v1.register(pipelineRoutes, { prefix: '/api/v1' });
    await v1.register(dealRoutes, { prefix: '/api/v1' });
    await v1.register(tagRoutes, { prefix: '/api/v1' });
    await v1.register(noteRoutes, { prefix: '/api/v1' });
    await v1.register(taskRoutes, { prefix: '/api/v1' });
    await v1.register(customFieldRoutes, { prefix: '/api/v1' });
    await v1.register(attentionRoutes, { prefix: '/api/v1' });
    await v1.register(searchRoutes, { prefix: '/api/v1' });
    await v1.register(serviceKeyRoutes, { prefix: '/api/v1' });
  });

  return app;
}

function swaggerHtml(baseUrl: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>DEPARTIFY CRM API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({ url: '${baseUrl}/openapi.json', dom_id: '#swagger' });
      };
    </script>
  </body>
</html>`;
}
