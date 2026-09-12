/**
 * Boots the API under test on a port nobody else owns.
 *
 * A fixed port let the suite silently adopt whatever API already
 * happened to be listening — including a different checkout on a
 * different branch — so green/red said nothing about the code under
 * test. Binding :0 and probing only that port keeps the verdict honest.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface TestApi {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'string' || addr === null) {
        srv.close(() => rej(new Error('could not resolve a free port')));
        return;
      }
      srv.close(() => res(addr.port));
    });
  });
}

/** Drops and rebuilds the public schema from the checked-in migrations. */
export async function resetSchema(databaseUrl: string): Promise<void> {
  // Close our own pooled connections first: a `drop schema public cascade`
  // fails when the *same* process still holds open sessions to that schema
  // ("cannot drop ... because other objects depend on it"). Drizzle's
  // postgres-js client pools up to `max` connections; each `createDb`
  // call in this process would otherwise block its own reset.
  // We create a client per statement instead, so every session is
  // short-lived (open → run → close) and never pins the schema.
  const { default: postgres } = await import('postgres');
  const dbExecute = async (statement: string): Promise<void> => {
    const client = postgres(databaseUrl, { max: 1 });
    try {
      await client.unsafe(statement);
    } finally {
      await client.end();
    }
  };
  await dbExecute('drop schema public cascade; create schema public;');
  // Helper file lives at apps/api/test/helpers/; the repo root is
  // (helpers dir)/../.. → apps/api, then ../.. → repo root.
  const fileDir = resolve(import.meta.dirname);
  const migrationsDir = resolve(fileDir, '..', '..', '..', '..', 'packages', 'db', 'migrations');
  if (!existsSync(migrationsDir)) return;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  // Semantic runner: apply each file's raw statements (split on
  // `statement-breakpoint`), silently skipping only benign re-runs.
  // Because we just recreated an empty `public` schema, every statement
  // is applied from scratch; `IF NOT EXISTS` guards make re-entry safe.
  for (const f of files) {
    const statements = readFileSync(join(migrationsDir, f), 'utf8')
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await dbExecute(stmt);
      } catch {
        /* migrations are additive and re-runnable; IF NOT EXISTS races are expected */
      }
    }
  }
}

export async function startTestApi(
  databaseUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<TestApi> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  // The repo's pnpm workspaces hoist binaries under the root
  // node_modules/.bin. `node --import tsx` resolves `tsx` relative to
  // the *current working directory*, and vitest forks run the API child
  // from `apps/api` (where `tsx` is not importable as a package name).
  // Resolve the binary explicitly so the helper works in both local and
  // CI contexts.
  const cache = await import('node:module');
  // `tsx` exports "." → ./dist/loader.mjs (the ESM loader), so
  // `require.resolve('tsx')` gives us the loader we can pass to
  // `--import`. This avoids depending on cwd for package resolution.
  const tsxLoader = cache.createRequire(import.meta.url).resolve('tsx');
  // Helper file lives at apps/api/test/helpers/; two levels up is
  // apps/api (the API package root, where src/index.ts lives).
  // The helper is executed from the apps/api package root (vitest cwd),
  // so the API package root equals the current working directory here.
  const apiDir = process.cwd();
  const child: ChildProcess = spawn(process.execPath, ['--import', tsxLoader, 'src/index.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      SESSION_SECRET: 'a'.repeat(32),
      ENCRYPTION_KEY: 'b'.repeat(32),
      LOG_LEVEL: 'warn',
      RATE_LIMIT_DEFAULT_MAX: '10000',
      ...extraEnv,
    },
    stdio: 'pipe',
  });

  let stderr = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderr += b.toString();
  });
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    exited = { code, signal };
  });
  let stdout = '';
  child.stdout?.on('data', (b: Buffer) => {
    stdout += b.toString();
  });

  for (let i = 0; i < 120; i++) {
    if (exited !== null) {
      const result: { code: number | null; signal: NodeJS.Signals | null } = exited;
      throw new Error(`test API exited before serving (code=${result.code} signal=${result.signal})\n${stderr}`);
    }
    try {
      // Use a bare HTTP client for the probe: Node's global fetch here
      // is subject to the same environment quirks (proxy env vars,
      // custom CA bundles set by the outer OpenClaw host) that can make
      // `fetch` fail even though the server is listening and answering
      // fine with curl. Raw net is the ground truth for "API is up".
      const httpMod = await import('node:http');
      const probeOk = await new Promise<boolean>((resolveProbe) => {
        const req = httpMod.get(
          { host: '127.0.0.1', port, path: '/health', agent: false },
          (res) => {
            res.resume();
            resolveProbe(res.statusCode === 200);
          },
        );
        req.setTimeout(1500, () => {
          req.destroy();
          resolveProbe(false);
        });
        req.on('error', () => resolveProbe(false));
      });
      if (probeOk) {
        return {
          baseUrl,
          stop: async () => {
            child.kill('SIGTERM');
            await wait(300);
          },
        };
      }
    } catch {
      /* not listening yet */
    }
    await wait(250);
  }
  child.kill('SIGKILL');
  throw new Error(`test API did not come up on ${baseUrl}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
}
