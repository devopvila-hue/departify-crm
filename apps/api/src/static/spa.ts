/**
 * Locate the SPA build directory. We support a few candidate paths
 * because the API can be started from the source tree (dev), from
 * the compiled `dist/` (compiled run), or from the Docker image
 * where cwd is `/repo/apps/api`.
 */
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, resolve, normalize, sep, extname } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function locateWebDist(): string | null {
  const candidates = [
    resolve(process.cwd(), '..', 'web', 'dist'),         // cwd = apps/api (dev + docker)
    resolve(__dirname, '..', '..', 'web', 'dist'),       // compiled apps/api/dist/index.js
    resolve(process.cwd(), '..', '..', 'apps', 'web', 'dist'), // repo-root invocations
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function isApiPath(url: string): boolean {
  return (
    url.startsWith('/api/') ||
    url === '/api' ||
    url === '/openapi.json' ||
    url === '/docs' ||
    url === '/health' ||
    url === '/ready'
  );
}

/**
 * Mount the SPA: serve files from apps/web/dist/ when they exist,
 * fall back to index.html for any non-API GET so client-side routing
 * keeps working after a refresh.
 *
 * No-op (and a noop log line) when the SPA hasn't been built —
 * useful for tests and for running the API alone.
 */
export function mountSpa(app: FastifyInstance, webDist: string | null): void {
  if (!webDist) {
    app.log.info('SPA dist not found — serving API only');
    return;
  }
  const root = normalize(webDist);
  app.log.info({ webDist: root }, 'Serving SPA');

  app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
    if (isApiPath(req.url)) {
      return reply.code(404).send({
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found`,
        correlationId: req.id,
      });
    }

    // Decode and strip query string.
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/'));

    // Resolve and prevent path traversal.
    const candidate = path === '/' ? join(root, 'index.html') : join(root, path);
    const normalized = normalize(candidate);
    if (!normalized.startsWith(root + sep) && normalized !== join(root, 'index.html')) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid path',
        correlationId: req.id,
      });
    }

    // Try to serve the file directly.
    try {
      if (existsSync(normalized) && statSync(normalized).isFile()) {
        const ext = extname(normalized).toLowerCase();
        reply.type(MIME[ext] ?? 'application/octet-stream');
        // Cache static assets aggressively in production.
        if (ext && ext !== '.html') {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          reply.header('Cache-Control', 'no-cache');
        }
        return reply.send(createReadStream(normalized));
      }
    } catch {
      /* fall through to index.html */
    }

    // SPA fallback: serve index.html so client-side routes work on refresh.
    const indexPath = join(root, 'index.html');
    reply.type('text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    return reply.send(createReadStream(indexPath));
  });
}

export { locateWebDist };
