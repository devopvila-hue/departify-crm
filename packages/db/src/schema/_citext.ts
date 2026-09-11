/**
 * Leaf module: citext custom type, no other imports.
 *
 * Kept in its own file with zero internal imports so that the
 * `citext` value is never caught in a circular import cycle.
 * `_helpers.ts` re-exports it; `users.ts` and other consumers
 * import it directly to avoid the circular-init race where the
 * binding is still undefined when consumers evaluate.
 */
import { customType } from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
