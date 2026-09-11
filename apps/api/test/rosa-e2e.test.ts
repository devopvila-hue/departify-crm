/**
 * RosaService E2E real test — runs against the real Postgres database
 * pointed at by apps/api/.env (departify_crm_test, port 5433).
 *
 * Simulates the owner-specified producer→consumer resume pattern:
 *   Worker A: create ROSA → run llm_call → persist result → DIE before writeback
 *   Worker B: load ROSA → see llm_call completed → NO LLM repeat → writeback → complete
 *
 * Verifies: persistence, reload, revision, tenant isolation, handoff, writeback.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { config } from '../src/config.js';
import { RosaService, RosaConflictError } from '../src/rosa/service.js';

const db = createDb(config.DATABASE_URL);
const rosa = new RosaService(db);

// Test org: use an existing test org from the seed, or create one if missing.
const TEST_ORG_ID = 'rosa_e2e_test_org';
const TEST_ORG_B_ID = 'rosa_e2e_test_org_B';

// Cleanup helper: remove all ROSA rows for a given org.
async function cleanupRosa(orgId: string): Promise<void> {
  await db.execute(sql`DELETE FROM rosa_state WHERE organization_id = ${orgId}`);
}

beforeAll(async () => {
  // Ensure test orgs exist (referenced by FK from rosa_state).
  await db.execute(sql`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES (${TEST_ORG_ID}, 'Rosa E2E Test Org', 'rosa-e2e-test', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES (${TEST_ORG_B_ID}, 'Rosa E2E Test Org B', 'rosa-e2e-test-b', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanupRosa(TEST_ORG_ID);
  await cleanupRosa(TEST_ORG_B_ID);
});

const ctxA = { organizationId: TEST_ORG_ID };
const ctxB = { organizationId: TEST_ORG_B_ID };

describe('RosaService E2E (real Postgres)', () => {
  it('persists and reloads a ROSA', async () => {
    await cleanupRosa(TEST_ORG_ID);
    const workId = randomUUID();
    const created = await rosa.create(ctxA, {
      workId,
      objective: 'E2E persistence test',
      state: 'planned',
      payload: { pending: [{ id: 'step1', summary: 'do thing' }] },
    });
    expect(created.revision).toBe(1);

    const loaded = await rosa.get(ctxA, workId);
    expect(loaded).not.toBeNull();
    expect(loaded!.rosaId).toBe(created.rosaId);
    expect(loaded!.objective).toBe('E2E persistence test');
  });

  it('enforces tenant isolation — org B cannot see org A ROSA', async () => {
    await cleanupRosa(TEST_ORG_ID);
    await cleanupRosa(TEST_ORG_B_ID);
    const workId = randomUUID();
    await rosa.create(ctxA, { workId, objective: 'org A only' });

    const fromA = await rosa.get(ctxA, workId);
    const fromB = await rosa.get(ctxB, workId);
    expect(fromA).not.toBeNull();
    expect(fromB).toBeNull();
  });

  it('append increments revision atomically; stale revision throws RosaConflictError', async () => {
    await cleanupRosa(TEST_ORG_ID);
    const workId = randomUUID();
    await rosa.create(ctxA, { workId, objective: 'revision test', state: 'in_progress' });

    const after1 = await rosa.append(ctxA, workId, 1, 'completed', { id: 'step1', summary: 'first' });
    expect(after1.revision).toBe(2);

    const after2 = await rosa.append(ctxA, workId, 2, 'completed', { id: 'step2', summary: 'second' });
    expect(after2.revision).toBe(3);

    // Stale revision should throw.
    await expect(
      rosa.append(ctxA, workId, 1, 'completed', { id: 'step3', summary: 'stale' }),
    ).rejects.toBeInstanceOf(RosaConflictError);
  });

  it('payload size cap rejects > 50KB', async () => {
    await cleanupRosa(TEST_ORG_ID);
    const huge = 'x'.repeat(60 * 1024);
    await expect(
      rosa.create(ctxA, {
        workId: randomUUID(),
        objective: 'size cap',
        payload: { evidence_refs: [huge] },
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it('producer→consumer resume: worker B sees worker A progress without redo', async () => {
    await cleanupRosa(TEST_ORG_ID);
    const workId = randomUUID();

    // === Worker A: first invocation ===
    // Step 1: create ROSA with planned steps
    const created = await rosa.create(ctxA, {
      workId,
      objective: 'Summarize contact X (E2E)',
      state: 'in_progress',
      payload: {
        evidence_refs: ['departify://contact/test'],
        pending: [
          { id: 'llm_call', summary: 'Invoke LLM' },
          { id: 'writeback', summary: 'Persist to contacts.customValues' },
        ],
        next_action: { who: 'ai_summarize_contact', what: 'Run LLM call' },
        verification: { criteria: ['llm_call.completed', 'writeback.completed'], status: 'pending' },
      },
    });
    expect(created.revision).toBe(1);

    // Step 2: simulate LLM call completes (NO actual LLM — deterministic)
    const fakeLlmResult = { who: 'X', next_step: 'follow up' };
    const afterLlm = await rosa.append(ctxA, workId, 1, 'completed', { id: 'llm_call', summary: 'LLM returned' });
    expect(afterLlm.revision).toBe(2);

    const afterResult = await rosa.append(ctxA, workId, 2, 'results', {
      id: 'llm_result',
      summary: JSON.stringify(fakeLlmResult),
    });
    expect(afterResult.revision).toBe(3);

    // === Worker A DIES HERE — before writeback ===

    // === Worker B: new invocation, same workId ===
    const snapshot = await rosa.get(ctxA, workId);
    expect(snapshot).not.toBeNull();
    const completedIds = new Set((snapshot!.payload.completed ?? []).map((c) => c.id));
    expect(completedIds.has('llm_call')).toBe(true);

    // Worker B detects llm_call is done — recovers result from ROSA, NO new LLM call.
    const recovered = snapshot!.payload.results?.[0];
    expect(recovered).toBeDefined();
    const parsedResult = JSON.parse((recovered as { summary: string }).summary);
    expect(parsedResult).toEqual(fakeLlmResult);

    // Worker B performs writeback (simulate contacts update + ROSA append).
    const afterWb = await rosa.append(ctxA, workId, snapshot!.revision, 'completed', {
      id: 'writeback',
      summary: 'Summary persisted to contacts.customValues',
    });
    expect(afterWb.revision).toBe(4);

    // Worker B transitions to complete.
    const final = await rosa.transition(ctxA, workId, 4, 'complete');
    expect(final.state).toBe('complete');
    expect(final.revision).toBe(5);

    // Final verification.
    const verify = await rosa.get(ctxA, workId);
    expect(verify!.state).toBe('complete');
    expect((verify!.payload.completed ?? []).map((c) => c.id)).toEqual(['llm_call', 'writeback']);
  });

  it('final-state semantics: transition to complete sets verification.status=passed, empties pending, omits next_action', async () => {
    await cleanupRosa(TEST_ORG_ID);
    const workId = randomUUID();

    // Set up ROSA with criteria declared, pending populated, and a next_action.
    const created = await rosa.create(ctxA, {
      workId,
      objective: 'final-state semantics test',
      state: 'in_progress',
      payload: {
        pending: [
          { id: 'do_a', summary: 'do thing A' },
          { id: 'do_b', summary: 'do thing B' },
        ],
        next_action: { who: 'worker', what: 'do thing A' },
        verification: { criteria: ['do_a.done', 'do_b.done'], status: 'pending' },
      },
    });

    // Simulate completing the pending work by appending to completed
    // (this also bumps the revision, which the caller must track).
    const afterA = await rosa.append(ctxA, workId, created.revision, 'completed', { id: 'do_a', summary: 'A done' });
    const afterB = await rosa.append(ctxA, workId, afterA.revision, 'completed', { id: 'do_b', summary: 'B done' });

    // Transition to complete — this MUST atomically patch the payload.
    const finalSnap = await rosa.transition(ctxA, workId, afterB.revision, 'complete');

    expect(finalSnap.state).toBe('complete');

    // verification.status MUST be 'passed' when criteria are declared and the
    // work transitions to complete.
    expect(finalSnap.payload.verification).toBeDefined();
    expect(finalSnap.payload.verification!.status).toBe('passed');
    expect(finalSnap.payload.verification!.criteria).toEqual(['do_a.done', 'do_b.done']);

    // pending MUST be empty for completed work (explicit empty array, not absent).
    expect(finalSnap.payload.pending).toBeDefined();
    expect(finalSnap.payload.pending).toEqual([]);

    // next_action MUST be omitted (v0.1-compatible representation of absence).
    expect(finalSnap.payload.next_action).toBeUndefined();

    // Verify reload — the semantic patch is durable.
    const reloaded = await rosa.get(ctxA, workId);
    expect(reloaded!.state).toBe('complete');
    expect(reloaded!.payload.pending).toEqual([]);
    expect(reloaded!.payload.next_action).toBeUndefined();
    expect(reloaded!.payload.verification!.status).toBe('passed');
  });
});
