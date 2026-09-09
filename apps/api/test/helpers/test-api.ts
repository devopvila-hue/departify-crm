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
import { sql } from 'drizzle-orm';
import { createDb } from '@departify-crm/db';

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
  const adminDb = createDb(databaseUrl);
  await adminDb.execute(sql`drop schema public cascade; create schema public;`);
  const migrationsDir = resolve(__dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
  if (!existsSync(migrationsDir)) return;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const statements = readFileSync(join(migrationsDir, f), 'utf8')
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await adminDb.execute(sql.raw(stmt));
      } catch {
        /* migrations are additive and re-runnable; IF NOT EXISTS races are expected */
      }
    }
  }
}

export async function startTestApi(databaseUrl: string): Promise<TestApi> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(__dirname, '..', '..'),
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
    },
    stdio: 'pipe',
  });

  let stderr = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderr += b.toString();
  });
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  for (let i = 0; i < 120; i++) {
    if (exited) {
      throw new Error(`test API exited before serving (code=${exited.code} signal=${exited.signal})\n${stderr}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
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
  throw new Error(`test API did not come up on ${baseUrl}\n${stderr}`);
}
