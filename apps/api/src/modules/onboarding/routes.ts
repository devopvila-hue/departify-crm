/**
 * DEPARTIFY CRM — onboarding preparation module.
 *
 * Customer-facing lifecycle for the zero-question onboarding:
 *
 *   auth → preparing → ready | partial | needs_attention
 *
 * The API exposes REAL, durable state per organization (onboarding_prep).
 * The UI derives cards and copy from this state — never from fake timers.
 * Provider capabilities (calendar/mail/drive) are represented as prep
 * cards with lifecycle states; OAuth credentials themselves never touch
 * this module (they live in future dedicated connection storage).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import type { PrepCardState } from '@departify-crm/db/schema/onboarding';
import { badRequest } from '../../errors.js';
import { audit } from '../../audit/log.js';

const CARD_KEYS = ['company', 'calendar', 'mail', 'drive', 'workspace'] as const;
const CARD_STATES = ['waiting', 'preparing', 'ready', 'needs_permission', 'skipped', 'error'] as const;
const PHASES = ['not_started', 'preparing', 'ready', 'partial', 'needs_attention'] as const;

const cardStateSchema = z.enum(CARD_STATES);
const cardsSchema = z.record(z.enum(CARD_KEYS), cardStateSchema);

const StartBody = z.object({
  cards: cardsSchema.optional(),
});

const MoveBody = z.object({
  card: z.enum(CARD_KEYS),
  state: cardStateSchema,
});

/**
 * Map a set of card states to the overall phase, following the product
 * semantics: if every participating card is ready → 'ready'; if at least
 * one is ready and nothing failed → 'partial'; if a card errored →
 * 'needs_attention'; otherwise still 'preparing'.
 */
export function phaseFromCards(cards: Record<string, string>): (typeof PHASES)[number] {
  const values = Object.values(cards);
  if (values.length === 0) return 'not_started';
  if (values.includes('error') || values.includes('needs_permission')) return 'needs_attention';
  if (values.every((v) => v === 'ready' || v === 'skipped')) return 'ready';
  if (values.some((v) => v === 'ready')) return 'partial';
  return 'preparing';
}

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  /** GET /api/v1/onboarding — current preparation state (creates on first read). */
  app.get('/onboarding', async (req) => {
    const tenant = req.tenant!;
    const orgId = tenant.organizationId;

    let rows = await tenant.db.select().from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, orgId)).limit(1);

    if (!rows.length) {
      const created = await tenant.db
        .insert(schema.onboardingPrep)
        .values({ organizationId: orgId, phase: 'not_started', prepCards: {} })
        .onConflictDoNothing()
        .returning();
      rows = created.length ? created : await tenant.db.select().from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, orgId)).limit(1);
    }

    const row = rows[0]!;
    return {
      organizationId: row.organizationId,
      phase: row.phase,
      cards: row.prepCards,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  });

  /**
   * POST /api/v1/onboarding/start — begin preparation.
   * Idempotent; sets phase → preparing and started_at once.
   * Optional initial card states let the client record what actually
   * began (e.g. { company: 'preparing' }).
   */
  app.post('/onboarding/start', async (req, reply) => {
    const tenant = req.tenant!;
    const body = StartBody.parse(req.body ?? {});
    const orgId = tenant.organizationId;
    const cards = (body.cards ?? {}) as Record<string, PrepCardState>;

    const updated = await tenant.db
      .insert(schema.onboardingPrep)
      .values({
        organizationId: orgId,
        phase: 'preparing',
        startedAt: new Date(),
        prepCards: cards,
      })
      .onConflictDoUpdate({
        target: schema.onboardingPrep.organizationId,
        set: {
          phase: 'preparing',
          startedAt: sql`coalesce(${schema.onboardingPrep.startedAt}, now())`,
          prepCards: sql`coalesce(${schema.onboardingPrep.prepCards}, '{}'::jsonb) || (${JSON.stringify(cards)})::jsonb`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = updated[0]!;
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'onboarding', metadata: { event: 'start', phase: 'preparing' } });
    return reply.status(200).send({
      organizationId: row.organizationId,
      phase: row.phase,
      cards: row.prepCards,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    });
  });

  /**
   * POST /api/v1/onboarding/move — record one real capability transition.
   * Derives the overall phase from the resulting cards.
   */
  app.post('/onboarding/move', async (req, reply) => {
    const tenant = req.tenant!;
    const body = MoveBody.parse(req.body);

    const existing = await tenant.db.select().from(schema.onboardingPrep).where(eq(schema.onboardingPrep.organizationId, tenant.organizationId)).limit(1);
    const currentCards = { ...(existing[0]?.prepCards ?? {}) } as Record<string, PrepCardState>;
    currentCards[body.card] = body.state;

    const phase = phaseFromCards(currentCards);
    const updated = await tenant.db
      .insert(schema.onboardingPrep)
      .values({
        organizationId: tenant.organizationId,
        phase,
        prepCards: currentCards,
        startedAt: currentCards && Object.keys(currentCards).length > 0 ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: schema.onboardingPrep.organizationId,
        set: {
          phase,
          prepCards: currentCards,
          startedAt: sql`coalesce(${schema.onboardingPrep.startedAt}, now())`,
          completedAt: phase === 'ready' ? sql`coalesce(${schema.onboardingPrep.completedAt}, now())` : sql`${schema.onboardingPrep.completedAt}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = updated[0]!;
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'onboarding', metadata: { event: 'move', card: body.card, state: body.state, phase } });
    return reply.status(200).send({
      organizationId: row.organizationId,
      phase: row.phase,
      cards: row.prepCards,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    });
  });
}