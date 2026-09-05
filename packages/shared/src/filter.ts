/**
 * Filter expression — a tiny, composable filter language used by
 * Contacts, Companies and Deals list endpoints.
 *
 *   { op: 'eq', field: 'country', value: 'ES' }
 *   { op: 'and', children: [ ... ] }
 *   { op: 'or',  children: [ ... ] }
 *   { op: 'not', child:  { ... } }
 *
 * The API translates these to SQL with a strict allow-list of fields
 * per resource, so the surface is extensible without becoming a free
 * query language.
 */
import { z } from 'zod';

export const FilterLeaf = z.object({
  op: z.enum([
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'not_in',
    'contains',
    'starts_with',
    'is_null',
    'is_not_null',
    'exists',
  ]),
  field: z.string().min(1).max(64),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()).max(200)]).optional(),
});

export const FilterNode: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    FilterLeaf,
    z.object({ op: z.literal('and'), children: z.array(FilterNode).min(1).max(20) }),
    z.object({ op: z.literal('or'), children: z.array(FilterNode).min(1).max(20) }),
    z.object({ op: z.literal('not'), child: FilterNode }),
  ]),
);

export type FilterLeaf = z.infer<typeof FilterLeaf>;
export type FilterNode = FilterLeaf | { op: 'and'; children: FilterNode[] } | { op: 'or'; children: FilterNode[] } | { op: 'not'; child: FilterNode };

export const FilterBody = z.object({
  filter: FilterNode.optional(),
  search: z.string().max(200).optional(),
});
export type FilterBody = z.infer<typeof FilterBody>;
