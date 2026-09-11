import { text } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

// Re-export citext from its leaf module so existing consumers that
// import from `_helpers.js` keep working. The leaf lives in `_citext.ts`
// to avoid the circular-init race that previously made `citext`
// undefined when `users.ts` evaluated `citext('email')`.
export { citext } from './_citext.js';

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
