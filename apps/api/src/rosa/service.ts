/**
 * ROSA Service — repository for the rosa_state table.
 *
 * No HTTP routes. This service is consumed directly by the execution
 * path (e.g. the AI summarization tool) via:
 *
 *   const rosa = new RosaService(ctx.db);
 *   await rosa.create(ctx, { workId, objective, ...payload });
 *   const snapshot = await rosa.get(ctx, workId);
 *   await rosa.append(ctx, workId, expectedRevision, 'completed', { id, summary });
 *   await rosa.transition(ctx, workId, expectedRevision, 'complete');
 *
 * Tenant isolation: every method takes a TenantContext and filters by
 * `ctx.organizationId`. Callers MUST NOT pass orgId from anywhere else.
 */
import { eq, and } from 'drizzle-orm';
import { rosaState as rosaTable } from '@departify-crm/db/schema/rosa';
import type { RosaPayload, RosaRow } from '@departify-crm/db/schema/rosa';

// Minimal structural type for the RosaService constructor parameter.
// Avoids pulling the full @departify-crm/db barrel (which transitively
// imports users.ts → citext runtime init) at module load time.
// Compatible with `import { createDb } from '@departify-crm/db'`.
// The chainable query-builder return is `any` because structural-typing
// the full Drizzle query API is out of scope here; at runtime this
// passes through to the real Drizzle builders.
export type RosaDb = {
  select(): any;
  insert(table: unknown): any;
  update(table: unknown): any;
};
import type { TenantContext } from '../tenants/context.js';

export type RosaState =
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'awaiting_review'
  | 'complete'
  | 'abandoned';

export type RosaAppendField = 'completed' | 'pending' | 'results' | 'evidence_refs' | 'decisions' | 'blockers';

export interface RosaCreateInput {
  workId: string;
  objective: string;
  state?: RosaState;
  payload?: RosaPayload;
}

export interface RosaSnapshot {
  rosaId: string;
  rosaVersion: string;
  orgId: string;
  workId: string;
  objective: string;
  state: RosaState;
  payload: RosaPayload;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class RosaConflictError extends Error {
  constructor(public readonly expectedRevision: number, public readonly currentRevision: number) {
    super(`ROSA revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name = 'RosaConflictError';
  }
}

export class RosaNotFoundError extends Error {
  constructor(workId: string) {
    super(`ROSA not found for workId=${workId} in this tenant`);
    this.name = 'RosaNotFoundError';
  }
}

const MAX_PAYLOAD_BYTES = 50 * 1024; // 50KB hard cap

function toSnapshot(row: RosaRow): RosaSnapshot {
  return {
    rosaId: row.rosaId,
    rosaVersion: row.rosaVersion,
    orgId: row.orgId,
    workId: row.workId,
    objective: row.objective,
    state: row.state as RosaState,
    payload: row.payload,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertPayloadSize(payload: RosaPayload): void {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`ROSA payload exceeds ${MAX_PAYLOAD_BYTES} bytes (got ${size})`);
  }
}

export class RosaService {
  constructor(private readonly db: RosaDb) {}

  /**
   * Create a new ROSA. If a ROSA already exists for (orgId, workId),
   * returns the existing snapshot — never duplicates.
   */
  async create(ctx: Pick<TenantContext, 'organizationId'>, input: RosaCreateInput): Promise<RosaSnapshot> {
    const payload = input.payload ?? {};
    assertPayloadSize(payload);

    const existing = await this.db
      .select()
      .from(rosaTable)
      .where(and(eq(rosaTable.orgId, ctx.organizationId), eq(rosaTable.workId, input.workId)))
      .limit(1);
    if (existing.length > 0) return toSnapshot(existing[0] as RosaRow);

    const [row] = await this.db
      .insert(rosaTable)
      .values({
        orgId: ctx.organizationId,
        workId: input.workId,
        objective: input.objective,
        state: input.state ?? 'planned',
        payload,
        revision: 1,
      })
      .returning();
    if (!row) throw new Error('ROSA insert returned no row');
    return toSnapshot(row as RosaRow);
  }

  /**
   * Load the current ROSA for (orgId, workId). Returns null if not found.
   */
  async get(ctx: Pick<TenantContext, 'organizationId'>, workId: string): Promise<RosaSnapshot | null> {
    const rows = await this.db
      .select()
      .from(rosaTable)
      .where(and(eq(rosaTable.orgId, ctx.organizationId), eq(rosaTable.workId, workId)))
      .limit(1);
    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  /**
   * Append an entry to one of the payload arrays, with optimistic locking.
   * Idempotent on entry.id (server ignores duplicates within the same field).
   * Returns the new snapshot. Throws RosaConflictError on stale revision.
   */
  async append(
    ctx: Pick<TenantContext, 'organizationId'>,
    workId: string,
    expectedRevision: number,
    field: RosaAppendField,
    entry: { id: string; summary?: string; decision?: string; rationale?: string; description?: string },
  ): Promise<RosaSnapshot> {
    const current = await this.get(ctx, workId);
    if (!current) throw new RosaNotFoundError(workId);
    if (current.revision !== expectedRevision) {
      throw new RosaConflictError(expectedRevision, current.revision);
    }

    const nextPayload: RosaPayload = { ...current.payload };
    const existing = (nextPayload[field] as Array<{ id: string }> | undefined) ?? [];
    if (!existing.some((e) => e.id === entry.id)) {
      existing.push(entry as { id: string; summary: string });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nextPayload as any)[field] = existing;
    assertPayloadSize(nextPayload);

    const updated = await this.db
      .update(rosaTable)
      .set({ payload: nextPayload, revision: expectedRevision + 1, updatedAt: new Date() })
      .where(
        and(
          eq(rosaTable.orgId, ctx.organizationId),
          eq(rosaTable.workId, workId),
          eq(rosaTable.revision, expectedRevision),
        ),
      )
      .returning();
    if (updated.length === 0) {
      // Re-read to give the caller the current revision.
      const fresh = await this.get(ctx, workId);
      throw new RosaConflictError(expectedRevision, fresh?.revision ?? -1);
    }
    return toSnapshot(updated[0] as RosaRow);
  }

  /**
   * Transition state atomically with optimistic locking.
   */
  async transition(
    ctx: Pick<TenantContext, 'organizationId'>,
    workId: string,
    expectedRevision: number,
    newState: RosaState,
  ): Promise<RosaSnapshot> {
    const current = await this.get(ctx, workId);
    if (!current) throw new RosaNotFoundError(workId);
    if (current.revision !== expectedRevision) {
      throw new RosaConflictError(expectedRevision, current.revision);
    }

    // Final-state semantics: when transitioning to 'complete', atomically
    // patch payload so it represents a finished work item.
    //   - verification.status becomes 'passed' if criteria were declared
    //   - pending is emptied (no remaining steps)
    //   - next_action is omitted (v0.1-compatible representation of absence)
    // No new fields added; optional fields are simply unset.
    const updates: Record<string, unknown> = {
      state: newState,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    };
    if (newState === 'complete') {
      const nextPayload: RosaPayload = { ...current.payload, pending: [] };
      if (nextPayload.verification && Array.isArray(nextPayload.verification.criteria)) {
        nextPayload.verification = {
          ...nextPayload.verification,
          status: 'passed',
        };
      }
      // Omit next_action to signal "no further action" within v0.1 contract.
      delete (nextPayload as { next_action?: unknown }).next_action;
      updates.payload = nextPayload;
    }

    const updated = await this.db
      .update(rosaTable)
      .set(updates as Partial<RosaRow>)
      .where(
        and(
          eq(rosaTable.orgId, ctx.organizationId),
          eq(rosaTable.workId, workId),
          eq(rosaTable.revision, expectedRevision),
        ),
      )
      .returning();
    if (updated.length === 0) {
      const fresh = await this.get(ctx, workId);
      throw new RosaConflictError(expectedRevision, fresh?.revision ?? -1);
    }
    return toSnapshot(updated[0] as RosaRow);
  }

  /**
   * Update next_action atomically.
   */
  async setNextAction(
    ctx: Pick<TenantContext, 'organizationId'>,
    workId: string,
    expectedRevision: number,
    nextAction: { who: string; what: string },
  ): Promise<RosaSnapshot> {
    const current = await this.get(ctx, workId);
    if (!current) throw new RosaNotFoundError(workId);
    if (current.revision !== expectedRevision) {
      throw new RosaConflictError(expectedRevision, current.revision);
    }
    const nextPayload = { ...current.payload, next_action: nextAction };
    assertPayloadSize(nextPayload);
    const updated = await this.db
      .update(rosaTable)
      .set({ payload: nextPayload, revision: expectedRevision + 1, updatedAt: new Date() })
      .where(
        and(
          eq(rosaTable.orgId, ctx.organizationId),
          eq(rosaTable.workId, workId),
          eq(rosaTable.revision, expectedRevision),
        ),
      )
      .returning();
    if (updated.length === 0) {
      const fresh = await this.get(ctx, workId);
      throw new RosaConflictError(expectedRevision, fresh?.revision ?? -1);
    }
    return toSnapshot(updated[0] as RosaRow);
  }
}
