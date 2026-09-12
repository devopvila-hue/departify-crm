/**
 * DEPARTIFY CRM — onboarding preparation (honest, system-driven).
 *
 * The UI is pure DISPLAY of real backend state. There is no customer-facing
 * action that pretends work is happening: only the backend transitions card
 * states, and only when a REAL capability has finished doing something real.
 *
 * Two distinct notions, derived from the same card map:
 *
 *   READY_FOR_WORK       — Company AND Workspace are both 'ready'. The user
 *                          can leave the onboarding screen and use Departify.
 *                          This is what the UI's "[Empresa] está lista"
 *                          hero line reflects.
 *
 *   ALL_CONNECTIONS_READY — every card (including optional calendar/mail/drive)
 *                          is 'ready' or 'skipped'. Not currently in use
 *                          anywhere; left as an explicit concept so we never
 *                          confuse "you can work" with "everything is wired".
 *
 * Optional capabilities that DO NOT EXIST in this deployment yet (Calendar,
 * Mail, Drive) start in 'available_later' — the UI shows "puedes conectarlo
 * después" and nothing in the system will silently promote them to 'ready'.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import type { PrepCardState } from '@departify-crm/db/schema/onboarding';
import { badRequest } from '../../errors.js';
import { audit } from '../../audit/log.js';

/** Cards we render. Order is the visual order on the page. */
export const CARD_KEYS = ['company', 'workspace', 'calendar', 'mail', 'drive'] as const;
export type CardKey = (typeof CARD_KEYS)[number];

/** Honest states. Backend-only transitions. */
export const CARD_STATES = [
  'waiting',
  'preparing',
  'ready',
  'needs_permission',
  'available_later',
  'skipped',
  'error',
] as const;

export const PHASES = [
  'not_started',
  'preparing',
  'ready',
  'partial',
  'needs_attention',
] as const;
export type Phase = (typeof PHASES)[number];

const cardsSchema = z.record(z.string(), z.enum(CARD_STATES));

const StartBody = z.object({ cards: cardsSchema.optional() });

export type PrepCards = Partial<Record<CardKey, PrepCardState>>;

/**
 * REAL work that the backend can perform today, and what it produces.
 *
 * COMPANY:    an organization row + owner membership exist (signup guarantees it).
 * WORKSPACE:  the app row is reachable and the audit trail is open for the org.
 *
 * Anything else is "available_later" — the UI tells the user so, and the
 * backend never fabricates a 'ready' state for those.
 *
 * Calendar / Mail / Drive ARE NOT INTEGRATED in this deployment. They
 * default to 'available_later' on first start and stay there until a
 * REAL capability ships in a future sprint.
 */
export function realWorkAvailable(): Readonly<{ company: true; workspace: true }> {
  return { company: true, workspace: true } as const;
}

function deriveInitialCards(): PrepCards {
  // Calendar / Mail / Drive are honest "available_later" because they
  // are not built in this deployment. Company + Workspace start as
  // 'waiting' and become 'ready' when the backend's setup passes.
  const cards: PrepCards = {
    company: 'waiting',
    workspace: 'waiting',
    calendar: 'available_later',
    mail: 'available_later',
    drive: 'available_later',
  };
  return cards;
}

/**
 * Decide the high-level phase from the cards.
 *
 * READY_FOR_WORK is the predicate the UI cares about: Company AND Workspace
 * are 'ready'. ALL_CONNECTIONS_READY is what 'phase=ready' used to mean in
 * the old wizard; that wording is gone, but the *concept* survives so we
 * never silently conflate the two. Today, 'phase=ready' requires both:
 * Company + Workspace ready AND every optional card at terminal
 * (ready/skipped/available_later). Optional connections that haven't been
 * integrated land as 'available_later' which is terminal, so a fresh
 * org reaches phase=ready the moment Company + Workspace are real.
 */
export function derivePhase(cards: PrepCards): Phase {
  // Permission/error dominates everything. Even if READY_FOR_WORK is
  // technically true, surfacing a stuck card is the more honest signal:
  // the user needs to know something is waiting on them.
  if (anyError(cards)) return 'needs_attention';

  const readyForWork = isReadyForWork(cards);
  const allConnected = isAllConnectionsReady(cards);

  if (readyForWork && allConnected) return 'ready';
  if (readyForWork) return 'partial'; // optionals still pending (real ones, not "available_later")
  if (anyPreparing(cards)) return 'preparing';
  return 'preparing'; // default while we run real setup
}

export function isReadyForWork(cards: PrepCards): boolean {
  return cards.company === 'ready' && cards.workspace === 'ready';
}

/** All built capabilities are real (ready/skipped). Optionals that aren't
 *  built are honest 'available_later' and stay out of this predicate. */
export function isAllConnectionsReady(cards: PrepCards): boolean {
  for (const key of CARD_KEYS) {
    const v = cards[key];
    if (v === undefined) continue;
    if (v === 'available_later') continue;
    if (v !== 'ready' && v !== 'skipped') return false;
  }
  return true;
}

function anyPreparing(cards: PrepCards): boolean {
  return Object.values(cards).some((v) => v === 'preparing');
}

function anyError(cards: PrepCards): boolean {
  return Object.values(cards).some((v) => v === 'error' || v === 'needs_permission');
}

/**
 * Run the REAL setup work the backend can do today.
 *
 * Idempotent. Each operation either succeeds (→ 'ready') or leaves the card
 * untouched (→ stays 'waiting' / 'preparing'). Nothing here simulates work.
 *
 * REAL signals proven to exist in the codebase:
 *  - Company  → `organizations` row + active `memberships` row for the user.
 *               Both are inserted atomically in `/auth/signup`; we verify they
 *               are there. If yes → ready.
 *  - Workspace → the API is reachable and the session can perform a no-op
 *               audit write for this org. If yes → ready. (The audit log is
 *               what proves the app envelope is open for the org.)
 *
 * Optionals (Calendar/Mail/Drive) are NOT touched. They keep 'available_later'.
 */
export async function runRealSetup(db: {
  select: typeof schema.onboardingPrep.$inferSelect extends never ? never : never;
  // We accept the Drizzle db by duck-typing via a thin wrapper used in the route.
  queryOrganization: (orgId: string) => Promise<{ id: string } | null>;
  queryMembership: (orgId: string, userId: string) => Promise<{ id: string; status: string } | null>;
  writeAuditProbe: (orgId: string, userId: string, correlationId: string) => Promise<void>;
}, orgId: string, userId: string, correlationId: string): Promise<PrepCards> {
  const result: PrepCards = {
    company: 'waiting',
    workspace: 'waiting',
    calendar: 'available_later',
    mail: 'available_later',
    drive: 'available_later',
  };

  // COMPANY: org + membership present?
  const org = await db.queryOrganization(orgId);
  const membership = userId ? await db.queryMembership(orgId, userId) : null;
  if (org && membership && membership.status === 'active') {
    result.company = 'ready';
  }

  // WORKSPACE: app envelope accepts an audit write for this org?
  try {
    await db.writeAuditProbe(orgId, userId, correlationId);
    result.workspace = 'ready';
  } catch {
    result.workspace = 'error';
  }

  return result;
}

/** Internal: write a card state into the persisted row. NOT exposed as an HTTP
 *  endpoint. The setup loop and future real operations use this; the UI never
 *  does (the UI is read-only display). */
async function moveInternal(
  db: Awaited<ReturnType<typeof import('@departify-crm/db').createDb>>,
  orgId: string,
  card: CardKey,
  state: PrepCardState,
  correlationId: string,
): Promise<PrepCards> {
  const existing = await db.select().from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, orgId)).limit(1);
  const current: PrepCards = { ...(existing[0]?.prepCards ?? {}) } as PrepCards;
  current[card] = state;
  const phase = derivePhase(current);
  await db
    .insert(schema.onboardingPrep)
    .values({
      organizationId: orgId,
      phase,
      prepCards: current,
      startedAt: sql`coalesce(${schema.onboardingPrep.startedAt}, now())`,
      completedAt: phase === 'ready' ? sql`coalesce(${schema.onboardingPrep.completedAt}, now())` : sql`${schema.onboardingPrep.completedAt}`,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.onboardingPrep.organizationId,
      set: {
        phase,
        prepCards: current,
        startedAt: sql`coalesce(${schema.onboardingPrep.startedAt}, now())`,
        completedAt: phase === 'ready' ? sql`coalesce(${schema.onboardingPrep.completedAt}, now())` : sql`${schema.onboardingPrep.completedAt}`,
        updatedAt: new Date(),
      },
    });
  await audit(
    db as unknown as import('@departify-crm/db').Database,
    { userId: null, organizationId: orgId, actorKind: 'service', correlationId },
    { action: 'update', resourceType: 'onboarding', metadata: { event: 'move', card, state, phase } },
  );
  return current;
}

function serialize(row: { organizationId: string; phase: string; prepCards: Record<string, unknown> | null; startedAt: Date | null; completedAt: Date | null }) {
  const cards = (row.prepCards ?? {}) as PrepCards;
  return {
    organizationId: row.organizationId,
    phase: row.phase,
    cards,
    /** Predicate the UI mirrors 1:1: "Departify can already work with you". */
    readyForWork: isReadyForWork(cards),
    /** Strict superset: every built capability is real. Optionals that haven't
     *  been integrated stay 'available_later' and don't block this. */
    allConnectionsReady: isAllConnectionsReady(cards),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  /** GET /api/v1/onboarding — current preparation state. Idempotent.
   *  Returns the same shape no matter how many times it's called. The UI
   *  uses this to mirror system state, never to mutate it. */
  app.get('/onboarding', async (req) => {
    const tenant = req.tenant!;
    const orgId = tenant.organizationId;
    const db = tenant.db;

    let rows = await db.select().from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, orgId)).limit(1);
    if (!rows.length) {
      // Don't create a row here. The first write belongs to /start (which
      // runs the real setup). A bare GET on a fresh org returns the
      // initial map of cards without persisting yet.
      return serialize({
        organizationId: orgId,
        phase: 'not_started',
        prepCards: deriveInitialCards(),
        startedAt: null,
        completedAt: null,
      });
    }
    return serialize(rows[0]!);
  });

  /**
   * POST /api/v1/onboarding/start — run the REAL setup the backend can do
   * today, persist the result, return it. Idempotent.
   *
   * The body is accepted only for forward-compat (e.g. future setup hooks).
   * Today the body is ignored: setup is system-driven, not user-driven.
   */
  app.post('/onboarding/start', async (req, reply) => {
    const tenant = req.tenant!;
    StartBody.parse(req.body ?? {});
    const orgId = tenant.organizationId;
    const db = tenant.db;

    // Real setup signal #1: organization + active membership.
    const orgRow = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);
    const membershipRow = tenant.userId
      ? await db
          .select({ id: schema.memberships.id, status: schema.memberships.status })
          .from(schema.memberships)
          .where(eq(schema.memberships.userId, tenant.userId))
          .limit(1)
      : [];

    // Real setup signal #2: app envelope accepts an audit write.
    // A failed write means the app is not ready for the org's session.
    let auditOk = false;
    try {
      await audit(db, tenant, { action: 'integration_change', resourceType: 'onboarding', metadata: { event: 'workspace_probe' } });
      auditOk = true;
    } catch {
      auditOk = false;
    }

    const cards: PrepCards = {
      ...deriveInitialCards(),
      company: orgRow.length > 0 && membershipRow.length > 0 && membershipRow[0]!.status === 'active' ? 'ready' : 'waiting',
      workspace: auditOk ? 'ready' : 'error',
    };
    const phase = derivePhase(cards);
    const isNew = (
      await db.select({ id: schema.onboardingPrep.organizationId }).from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, orgId)).limit(1)
    ).length === 0;

    const updated = await db
      .insert(schema.onboardingPrep)
      .values({
        organizationId: orgId,
        phase,
        prepCards: cards,
        startedAt: new Date(),
        completedAt: phase === 'ready' ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: schema.onboardingPrep.organizationId,
        set: {
          phase,
          prepCards: cards,
          startedAt: sql`coalesce(${schema.onboardingPrep.startedAt}, now())`,
          completedAt: phase === 'ready' ? sql`coalesce(${schema.onboardingPrep.completedAt}, now())` : sql`${schema.onboardingPrep.completedAt}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    await audit(db, tenant, { action: 'create', resourceType: 'onboarding', metadata: { event: 'start', phase, isNew } });
    return reply.status(200).send(serialize(updated[0]!));
  });

  // NOTE: No POST /onboarding/move endpoint. Card transitions are a
  // backend responsibility triggered by REAL work (audit probes, future
  // calendar/mail/drive connectors). The internal helper `moveInternal`
  // is exported below for those future operations to reuse.
  // Exporting it here would couple the UI to a wizard control; we
  // explicitly do not.
  void moveInternal;
}
