/**
 * Filter → SQL translator. Strict allow-list per resource prevents
 * arbitrary column reads. Only used by the Contacts / Companies /
 * Deals list endpoints; everything else queries by primary key.
 */
import type { SQL } from 'drizzle-orm';
import { and, eq, ne, gt, gte, lt, lte, inArray, notInArray, ilike, sql, isNull, isNotNull, exists, not } from 'drizzle-orm';
import type { FilterNode, FilterLeaf } from '@departify-crm/shared';

type Allowed = Record<string, SQL | undefined>;

function leafToSql(node: FilterLeaf, allowed: Allowed): SQL | undefined {
  const col = allowed[node.field];
  if (!col) return undefined;
  switch (node.op) {
    case 'eq':
      return eq(col, node.value as never);
    case 'neq':
      return ne(col, node.value as never);
    case 'lt':
      return lt(col, node.value as never);
    case 'lte':
      return lte(col, node.value as never);
    case 'gt':
      return gt(col, node.value as never);
    case 'gte':
      return gte(col, node.value as never);
    case 'in':
      return inArray(col, (node.value as string[]) ?? []);
    case 'not_in':
      return notInArray(col, (node.value as string[]) ?? []);
    case 'contains':
      return ilike(col, `%${(node.value as string) ?? ''}%`);
    case 'starts_with':
      return ilike(col, `${(node.value as string) ?? ''}%`);
    case 'is_null':
      return isNull(col);
    case 'is_not_null':
      return isNotNull(col);
    case 'exists':
      return exists(sql`select 1`);
  }
}

function buildNode(node: FilterNode, allowed: Allowed): SQL | undefined {
  if (node.op === 'and' || node.op === 'or') {
    const parts = node.children.map((c) => buildNode(c, allowed)).filter((x): x is SQL => !!x);
    if (!parts.length) return undefined;
    return node.op === 'and' ? and(...parts) : sql`(${parts.reduce((acc, p, i) => (i === 0 ? p : sql`${acc} OR ${p}`))})`;
  }
  if (node.op === 'not') {
    const inner = buildNode(node.child, allowed);
    return inner ? not(inner) : undefined;
  }
  return leafToSql(node, allowed) ?? undefined;
}

export function compileFilter(
  node: FilterNode | undefined,
  allowed: Allowed,
  _orgId: SQL,
): SQL | undefined {
  if (!node) return undefined;
  return buildNode(node, allowed) ?? undefined;
}
