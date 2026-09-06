import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { lookup as dnsLookup } from 'node:dns';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  // Force IPv4. Supabase publishes AAAA (IPv6) records for the db
  // host and some runtime environments (notably Railway's default
  // network) have IPv6 in DNS but not in routing, which causes
  // ENETUNREACH on connect. Wrapping the DNS resolver with
  // { family: 4 } skips the IPv6 attempt without touching the
  // connection string.
  //
  // The `lookup` option is supported by postgres-js at runtime but
  // not declared in the bundled types (3.4.x). We cast to keep TS
  // happy without a custom .d.ts.
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
    ...({
      lookup: (hostname: string, options: any, callback: any) =>
        dnsLookup(hostname, { ...options, family: 4 }, callback),
    } as Record<string, unknown>),
  } as Parameters<typeof postgres>[1]);
  return drizzle(client, { schema, logger: false });
}


