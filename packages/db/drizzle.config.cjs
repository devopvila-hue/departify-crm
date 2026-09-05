// CJS config so drizzle-kit can require it without ESM gymnastics.
const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm';
// We bundle the schema to a single CJS file so drizzle-kit can
// require it without tripping on .js ↔ .ts resolution.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '.drizzle-bundle');
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, 'schema.cjs');
execSync(
  `npx esbuild src/schema/index.ts --bundle --format=cjs --platform=node --outfile=${out} --target=node20 --log-level=error`,
  { stdio: 'inherit' },
);

module.exports = {
  schema: out,
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
};
