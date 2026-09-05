// Tiny wrapper around drizzle-kit's programmatic API so we can run it
// via tsx and avoid the CJS/ESM import gotcha in the config file.
import { defineConfig } from 'drizzle-kit';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm';
  const out = resolve(import.meta.dirname, '..', 'packages', 'db', 'migrations');
  mkdirSync(out, { recursive: true });

  const { generate } = await import('drizzle-kit');

  await generate(
    defineConfig({
      schema: './packages/db/src/schema/index.ts',
      out: './packages/db/migrations',
      dialect: 'postgresql',
      dbCredentials: { url },
      strict: true,
      verbose: false,
    }),
  );
  console.log(`Migrations written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
