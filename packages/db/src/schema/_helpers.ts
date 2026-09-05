import { text, customType } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * `citext` custom type — case-insensitive text. Used for emails and
 * normalized identifiers where we want lookups to be case-insensitive
 * without forcing every caller to lower().
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/** Lazy references — Drizzle evaluates them at SQL generation time,
 * not at table-definition time, so circular imports are safe. */
export const orgId = () =>
  text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const userId = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
