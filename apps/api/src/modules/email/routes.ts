/**
 * DEPARTIFY CRM — Email module routes
 *
 * - /api/v1/email/senders            CRUD of senders (with encrypted credentials)
 * - /api/v1/email/templates          CRUD of templates (with variable preview)
 * - /api/v1/email/sequences          CRUD of sequences (steps jsonb)
 * - /api/v1/email/sequences/:id/enrollments
 * - /api/v1/email/enrollments/:id    pause / resume / exit
 * - /api/v1/email/preview            render a template with a sample context
 * - /api/v1/email/suppressions       list (manual add/remove for hard cases)
 * - /api/v1/unsubscribe              public, signed token, no auth required
 * - /api/v1/webhooks/:provider       provider → normalized event
 *
 * All routes enforce tenant isolation: req.tenant.organizationId.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import * as dbPkg from '@departify-crm/db';
import { generateId, Prefixes, renderEmail, previewContext, type EmailWebhookEvent as _EW } from '@departify-crm/shared';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { badRequest, conflict, notFound, unauthorized } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { makeProvider } from '../../email/providers.js';
import { signUnsubToken, verifyUnsubToken } from '../../email/unsubToken.js';
import { config } from '../../config.js';

const schema = dbPkg.schema;
const { createDb } = dbPkg;

// ─── senders ───────────────────────────────────────────────────────────

const SenderCreate = z.object({
  provider: z.enum(['resend', 'brevo', 'fake']),
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  replyTo: z.string().email().max(254).optional(),
  /** Plaintext credentials the API will encrypt at rest. Returned only on create. */
  credentials: z.object({
    apiKey: z.string().min(1).max(500),
  }),
  dailyLimit: z.number().int().min(1).max(1_000_000).default(500),
});

const SenderUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(254).optional(),
  replyTo: z.string().email().max(254).nullable().optional(),
  dailyLimit: z.number().int().min(1).max(1_000_000).optional(),
  status: z.enum(['active', 'paused', 'pending', 'disabled']).optional(),
});

function redactSender(row: typeof schema.emailSenders.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    email: row.email,
    replyTo: row.replyTo,
    status: row.status,
    dailyLimit: row.dailyLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function senderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/email/senders', async (req) => {
    const tenant = req.tenant!;
    const rows = await tenant.db
      .select()
      .from(schema.emailSenders)
      .where(eq(schema.emailSenders.organizationId, tenant.organizationId))
      .orderBy(asc(schema.emailSenders.createdAt));
    return rows.map(redactSender);
  });

  app.post('/email/senders', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const body = SenderCreate.parse(req.body);
    if (body.provider === 'fake') {
      // For 'fake' we still require an apiKey field but never encrypt
      // anything sensitive. We store a placeholder so the row format
      // stays uniform.
      const id = generateId(Prefixes.emailSender);
      await tenant.db.insert(schema.emailSenders).values({
        id,
        organizationId: tenant.organizationId,
        provider: 'fake',
        name: body.name,
        email: body.email,
        replyTo: body.replyTo ?? null,
        credentialsEncrypted: JSON.stringify({ kind: 'fake' }),
        status: 'active',
        dailyLimit: body.dailyLimit,
      });
      await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'sender' });
      const row = (await tenant.db.select().from(schema.emailSenders).where(eq(schema.emailSenders.id, id)))[0]!;
      return reply.status(201).send(redactSender(row));
    }
    const id = generateId(Prefixes.emailSender);
    const encrypted = encryptSecret(JSON.stringify({ apiKey: body.credentials.apiKey }));
    await tenant.db.insert(schema.emailSenders).values({
      id,
      organizationId: tenant.organizationId,
      provider: body.provider,
      name: body.name,
      email: body.email,
      replyTo: body.replyTo ?? null,
      credentialsEncrypted: encrypted,
      status: 'pending',
      dailyLimit: body.dailyLimit,
    });
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'sender', resourceId: id });
    const row = (await tenant.db.select().from(schema.emailSenders).where(eq(schema.emailSenders.id, id)))[0]!;
    return reply.status(201).send(redactSender(row));
  });

  app.patch('/email/senders/:id', { preHandler: [requireRole('admin')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = SenderUpdate.parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.replyTo !== undefined) updates.replyTo = body.replyTo;
    if (body.dailyLimit !== undefined) updates.dailyLimit = body.dailyLimit;
    if (body.status !== undefined) updates.status = body.status;
    const res = await tenant.db
      .update(schema.emailSenders)
      .set(updates)
      .where(and(eq(schema.emailSenders.organizationId, tenant.organizationId), eq(schema.emailSenders.id, id)))
      .returning({ id: schema.emailSenders.id });
    if (!res.length) throw notFound('Sender not found');
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'sender', resourceId: id });
    return { ok: true, id };
  });

  app.delete('/email/senders/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.emailSenders)
      .where(and(eq(schema.emailSenders.organizationId, tenant.organizationId), eq(schema.emailSenders.id, id)))
      .returning({ id: schema.emailSenders.id });
    if (!res.length) throw notFound('Sender not found');
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'sender', resourceId: id });
    return reply.status(204).send();
  });
}

// ─── templates ────────────────────────────────────────────────────────

const TemplateCreate = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  htmlBody: z.string().max(200_000).optional(),
  senderId: z.string().optional(),
});

const TemplateUpdate = TemplateCreate.partial();

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/email/templates', async (req) => {
    const tenant = req.tenant!;
    const rows = await tenant.db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.organizationId, tenant.organizationId))
      .orderBy(desc(schema.emailTemplates.createdAt));
    return rows;
  });

  app.post('/email/templates', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const body = TemplateCreate.parse(req.body);
    const id = generateId(Prefixes.emailTemplate);
    await tenant.db.insert(schema.emailTemplates).values({
      id,
      organizationId: tenant.organizationId,
      name: body.name,
      subject: body.subject,
      body: body.body,
      htmlBody: body.htmlBody ?? null,
      senderId: body.senderId ?? null,
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'email_template', resourceId: id });
    const row = (await tenant.db.select().from(schema.emailTemplates).where(eq(schema.emailTemplates.id, id)))[0]!;
    return reply.status(201).send(row);
  });

  app.patch('/email/templates/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = TemplateUpdate.parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k === 'htmlBody' ? 'htmlBody' : k] = v;
    }
    const res = await tenant.db
      .update(schema.emailTemplates)
      .set(updates)
      .where(and(eq(schema.emailTemplates.organizationId, tenant.organizationId), eq(schema.emailTemplates.id, id)))
      .returning({ id: schema.emailTemplates.id });
    if (!res.length) throw notFound('Template not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'email_template', resourceId: id });
    return { ok: true, id };
  });

  app.delete('/email/templates/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.organizationId, tenant.organizationId), eq(schema.emailTemplates.id, id)))
      .returning({ id: schema.emailTemplates.id });
    if (!res.length) throw notFound('Template not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'email_template', resourceId: id });
    return reply.status(204).send();
  });

  // Render a template with a sample context, for the builder preview.
  app.post('/email/preview', async (req) => {
    const body = z
      .object({
        subject: z.string(),
        body: z.string(),
        htmlBody: z.string().optional(),
        sample: z
          .object({
            contact: z.object({ firstName: z.string().optional(), lastName: z.string().optional(), fullName: z.string().optional(), email: z.string().optional(), jobTitle: z.string().optional() }).optional(),
            organization: z.object({ name: z.string().optional() }).optional(),
            sender: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const ctx = previewContext({
      contact: body.sample?.contact ?? {},
      organization: body.sample?.organization ?? {},
      sender: body.sample?.sender ?? {},
    });
    return renderEmail({ subject: body.subject, text: body.body, html: body.htmlBody }, ctx);
  });
}

// ─── sequences ───────────────────────────────────────────────────────

const SequenceStep = z.object({
  kind: z.enum(['email', 'wait', 'conditional', 'exit']),
  templateId: z.string().optional(),
  senderId: z.string().optional(),
  waitDays: z.number().int().min(0).max(365).optional(),
  /** For 'conditional': if previous event was 'opened' / 'clicked' / 'replied', what to do */
  ifEvent: z.enum(['opened', 'clicked', 'replied', 'bounced']).optional(),
  thenAction: z.enum(['continue', 'exit']).optional(),
});

const SequenceCreate = z.object({
  name: z.string().min(1).max(120),
  senderId: z.string().optional(),
  timezone: z.string().default('Europe/Madrid'),
  sendingWindowStart: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  sendingWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  steps: z.array(SequenceStep).min(1).max(50),
});

const SequenceUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  senderId: z.string().nullable().optional(),
  timezone: z.string().optional(),
  sendingWindowStart: z.string().optional(),
  sendingWindowEnd: z.string().optional(),
  steps: z.array(SequenceStep).min(1).max(50).optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
});

export async function sequenceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/email/sequences', async (req) => {
    const tenant = req.tenant!;
    return tenant.db
      .select()
      .from(schema.sequences)
      .where(eq(schema.sequences.organizationId, tenant.organizationId))
      .orderBy(desc(schema.sequences.createdAt));
  });

  app.post('/email/sequences', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const body = SequenceCreate.parse(req.body);
    const id = generateId(Prefixes.sequence);
    await tenant.db.insert(schema.sequences).values({
      id,
      organizationId: tenant.organizationId,
      name: body.name,
      senderId: body.senderId ?? null,
      status: 'draft',
      timezone: body.timezone,
      sendingWindowStart: body.sendingWindowStart,
      sendingWindowEnd: body.sendingWindowEnd,
      steps: body.steps,
    });
    await audit(tenant.db, tenant, { action: 'sequence_change', resourceType: 'sequence', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.patch('/email/sequences/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = SequenceUpdate.parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const res = await tenant.db
      .update(schema.sequences)
      .set(updates)
      .where(and(eq(schema.sequences.organizationId, tenant.organizationId), eq(schema.sequences.id, id)))
      .returning({ id: schema.sequences.id });
    if (!res.length) throw notFound('Sequence not found');
    await audit(tenant.db, tenant, { action: 'sequence_change', resourceType: 'sequence', resourceId: id });
    return { ok: true, id };
  });

  // Enroll a single contact in a sequence.
  app.post('/email/sequences/:id/enrollments', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const sequenceId = z.string().parse((req.params as { id: string }).id);
    const body = z.object({ contactId: z.string() }).parse(req.body);

    // Make sure the sequence and the contact belong to this org.
    const seq = (await tenant.db
      .select()
      .from(schema.sequences)
      .where(and(eq(schema.sequences.organizationId, tenant.organizationId), eq(schema.sequences.id, sequenceId)))
      .limit(1))[0];
    if (!seq) throw notFound('Sequence not found');
    const contact = (await tenant.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, body.contactId)))
      .limit(1))[0];
    if (!contact) throw notFound('Contact not found');
    if (!contact.email) throw badRequest('Contact has no email');

    // Check suppression.
    const sup = (await tenant.db
      .select()
      .from(schema.suppressions)
      .where(and(eq(schema.suppressions.organizationId, tenant.organizationId), eq(schema.suppressions.email, contact.email)))
      .limit(1))[0];
    if (sup) throw conflict('Contact is suppressed');

    // Idempotent: if already enrolled (and active/paused), return it.
    const existing = (await tenant.db
      .select()
      .from(schema.sequenceEnrollments)
      .where(and(
        eq(schema.sequenceEnrollments.organizationId, tenant.organizationId),
        eq(schema.sequenceEnrollments.sequenceId, sequenceId),
        eq(schema.sequenceEnrollments.contactId, body.contactId),
      ))
      .limit(1))[0];
    if (existing && (existing.status === 'active' || existing.status === 'paused')) {
      return reply.status(200).send({ id: existing.id, alreadyEnrolled: true });
    }

    const id = generateId(Prefixes.sequenceEnrollment);
    // Compute initial nextActionAt: now + first wait step, or now if first step is email.
    const firstStep = (seq.steps as Array<{ kind: string; waitDays?: number }>)[0];
    const waitMs = firstStep?.kind === 'wait' ? (firstStep.waitDays ?? 0) * 24 * 60 * 60 * 1000 : 0;
    const nextActionAt = new Date(Date.now() + waitMs);

    if (existing) {
      // Re-enroll a previously exited/completed enrollment: reset state.
      await tenant.db
        .update(schema.sequenceEnrollments)
        .set({
          currentStep: 0,
          nextActionAt,
          status: 'active',
          exitReason: null,
          completedAt: null,
        })
        .where(eq(schema.sequenceEnrollments.id, existing.id));
      await audit(tenant.db, tenant, { action: 'enrollment', resourceType: 'sequence_enrollment', resourceId: existing.id, metadata: { sequenceId, contactId: body.contactId, reEnrolled: true } });
      return reply.status(200).send({ id: existing.id, reEnrolled: true });
    }

    await tenant.db.insert(schema.sequenceEnrollments).values({
      id,
      organizationId: tenant.organizationId,
      sequenceId,
      contactId: body.contactId,
      currentStep: 0,
      nextActionAt,
      status: 'active',
    });
    await audit(tenant.db, tenant, { action: 'enrollment', resourceType: 'sequence_enrollment', resourceId: id, metadata: { sequenceId, contactId: body.contactId } });
    return reply.status(201).send({ id });
  });

  app.get('/email/sequences/:id/enrollments', async (req) => {
    const tenant = req.tenant!;
    const sequenceId = z.string().parse((req.params as { id: string }).id);
    return tenant.db
      .select()
      .from(schema.sequenceEnrollments)
      .where(and(eq(schema.sequenceEnrollments.organizationId, tenant.organizationId), eq(schema.sequenceEnrollments.sequenceId, sequenceId)));
  });

  // Pause / resume / exit a single enrollment.
  app.post('/email/enrollments/:id/pause', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .update(schema.sequenceEnrollments)
      .set({ status: 'paused' })
      .where(and(eq(schema.sequenceEnrollments.organizationId, tenant.organizationId), eq(schema.sequenceEnrollments.id, id)))
      .returning({ id: schema.sequenceEnrollments.id });
    if (!res.length) throw notFound('Enrollment not found');
    return { ok: true, id, status: 'paused' };
  });

  app.post('/email/enrollments/:id/resume', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .update(schema.sequenceEnrollments)
      .set({ status: 'active' })
      .where(and(eq(schema.sequenceEnrollments.organizationId, tenant.organizationId), eq(schema.sequenceEnrollments.id, id)))
      .returning({ id: schema.sequenceEnrollments.id });
    if (!res.length) throw notFound('Enrollment not found');
    return { ok: true, id, status: 'active' };
  });

  app.post('/email/enrollments/:id/exit', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(req.body);
    const res = await tenant.db
      .update(schema.sequenceEnrollments)
      .set({ status: 'exited', exitReason: body.reason, completedAt: new Date() })
      .where(and(eq(schema.sequenceEnrollments.organizationId, tenant.organizationId), eq(schema.sequenceEnrollments.id, id)))
      .returning({ id: schema.sequenceEnrollments.id });
    if (!res.length) throw notFound('Enrollment not found');
    return { ok: true, id, status: 'exited' };
  });
}

// ─── suppressions ─────────────────────────────────────────────────────

const SuppressionCreate = z.object({
  email: z.string().email(),
  reason: z.enum(['unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid']),
  source: z.string().max(120).optional(),
});

export async function suppressionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/email/suppressions', async (req) => {
    const tenant = req.tenant!;
    return tenant.db
      .select()
      .from(schema.suppressions)
      .where(eq(schema.suppressions.organizationId, tenant.organizationId))
      .orderBy(desc(schema.suppressions.createdAt));
  });

  app.post('/email/suppressions', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const body = SuppressionCreate.parse(req.body);
    const id = generateId('supp');
    await tenant.db
      .insert(schema.suppressions)
      .values({
        id,
        organizationId: tenant.organizationId,
        email: body.email,
        reason: body.reason,
        source: body.source ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.suppressions.organizationId, schema.suppressions.email],
        set: { reason: body.reason, source: body.source ?? null },
      });
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'suppression', resourceId: id });
    return reply.status(201).send({ id });
  });
}

// ─── public unsubscribe (no auth) ───────────────────────────────────

export async function publicUnsubscribeRoutes(app: FastifyInstance) {
  // Anyone with a signed token can unsubscribe. No auth.
  app.get('/unsubscribe/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const decoded = verifyUnsubToken(token);
    if (!decoded) {
      return reply.type('text/html').send('<h1>Link inválido</h1>');
    }
    // Public endpoint: never trust the request's tenant. The token
    // itself encodes email + organizationId and is signed.
    return reply.type('text/html').send(`<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><title>Cancelar suscripción</title></head>
<body style="font-family: system-ui; max-width: 480px; margin: 4rem auto; padding: 0 1rem;">
<h1>¿Cancelar la suscripción?</h1>
<p>Vamos a dejar de enviarte emails desde <strong>${decoded.email}</strong>.</p>
<form method="POST" action="/unsubscribe/${token}">
  <button type="submit" style="padding: 0.6rem 1.2rem; background: #0A0C08; color: #D8FF62; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600;">Sí, cancelar</button>
</form>
</body>
</html>`);
  });

  app.post('/unsubscribe/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const decoded = verifyUnsubToken(token);
    if (!decoded) return reply.code(400).type('text/plain').send('Invalid token');
    // Use a one-off DB connection that targets the right org. We use
    // the orgId from the signed token, never the request tenant.
    const { createDb } = await import('@departify-crm/db');
    const db = createDb(process.env['DATABASE_URL']!);
    try {
      await db
        .insert(schema.suppressions)
        .values({
          id: generateId('supp'),
          organizationId: decoded.organizationId,
          email: decoded.email,
          reason: 'unsubscribed',
          source: 'public_link',
        })
        .onConflictDoUpdate({
          target: [schema.suppressions.organizationId, schema.suppressions.email],
          set: { reason: 'unsubscribed' },
        });
      // Auto-exit any active enrollments for this contact email.
      const contacts = await db
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.organizationId, decoded.organizationId), eq(schema.contacts.email, decoded.email)));
      for (const c of contacts) {
        await db
          .update(schema.sequenceEnrollments)
          .set({ status: 'exited', exitReason: 'unsubscribed', completedAt: new Date() })
          .where(and(
            eq(schema.sequenceEnrollments.organizationId, decoded.organizationId),
            eq(schema.sequenceEnrollments.contactId, c.id),
            eq(schema.sequenceEnrollments.status, 'active'),
          ));
      }
    } finally {
      // postgres-js uses a pool; closing is safe and frees resources.
      await db.$client.end?.().catch(() => undefined);
    }
    return reply.type('text/html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>Listo</title></head>
<body style="font-family: system-ui; max-width: 480px; margin: 4rem auto; padding: 0 1rem;">
<h1>Hecho.</h1>
<p>No recibirás más emails nuestros. Si ha sido un error, escríbenos a hola@tuempresa.</p>
</body></html>`);
  });

  // Helper used internally by the worker to mint a token for a recipient.
  app.get('/unsubscribe/_sign', async (req) => {
    // Protected: only the worker / admin can sign tokens. We require
    // an internal header set by the worker. In production this is
    // a shared secret; for dev we just check it's set.
    if (req.headers['x-internal-token'] !== config.UNSUB_SECRET) throw unauthorized();
    const q = z.object({ email: z.string().email(), organizationId: z.string() }).parse(req.query);
    return { token: signUnsubToken(q.email, q.organizationId) };
  });
}

// ─── webhooks ────────────────────────────────────────────────────────

export async function webhookRoutes(app: FastifyInstance) {
  // Provider webhooks are public (no auth) but signature-verified.
  // We can't trust req.tenant (no session) — we look up the org by
  // the provider message id and use a fresh db handle.
  app.post('/webhooks/resend', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string | Buffer }).rawBody?.toString('utf8') ?? '';
    const signature = (req.headers['svix-signature'] as string | undefined) ?? '';
    const event = (() => {
      try { return JSON.parse(raw); } catch { return null; }
    })();
    if (!event) return reply.code(400).send({ code: 'BAD_PAYLOAD' });
    const messageId = (event as { data?: { email_id?: string } } | null)?.data?.email_id ?? '';
    if (!messageId) return reply.code(202).send({ ok: true, ignored: true });

    const db = createDb(process.env['DATABASE_URL']!);
    try {
      const lookup = await db
        .select({ orgId: schema.messageEvents.organizationId, encrypted: schema.emailSenders.credentialsEncrypted })
        .from(schema.messageEvents)
        .innerJoin(schema.emailSenders, eq(schema.emailSenders.id, schema.messageEvents.senderId))
        .where(eq(schema.messageEvents.providerMessageId, messageId))
        .limit(1);
      if (!lookup.length) return reply.code(202).send({ ok: true, ignored: true });
      const { apiKey } = JSON.parse(decryptSecret(lookup[0]!.encrypted)) as { apiKey: string };
      const provider = makeProvider('resend', { apiKey });
      try {
        provider.verifyWebhook(raw, signature);
      } catch {
        return reply.code(401).send({ code: 'BAD_SIGNATURE' });
      }
      const ev = provider.parseWebhook(raw);
      await processProviderEvent(db, lookup[0]!.orgId, 'resend', ev);
      return { ok: true };
    } finally {
      await db.$client.end?.().catch(() => undefined);
    }
  });

  app.post('/webhooks/brevo', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string | Buffer }).rawBody?.toString('utf8') ?? '';
    const signature = (req.headers['x-brevo-signature'] as string | undefined) ?? '';
    const event = (() => {
      try { return JSON.parse(raw); } catch { return null; }
    })();
    if (!event) return reply.code(400).send({ code: 'BAD_PAYLOAD' });
    const ev0 = event as { messageId?: string; 'message-id'?: string };
    const messageId = ev0.messageId ?? ev0['message-id'] ?? '';
    if (!messageId) return reply.code(202).send({ ok: true, ignored: true });

    const db = createDb(process.env['DATABASE_URL']!);
    try {
      const lookup = await db
        .select({ orgId: schema.messageEvents.organizationId, encrypted: schema.emailSenders.credentialsEncrypted })
        .from(schema.messageEvents)
        .innerJoin(schema.emailSenders, eq(schema.emailSenders.id, schema.messageEvents.senderId))
        .where(eq(schema.messageEvents.providerMessageId, messageId))
        .limit(1);
      if (!lookup.length) return reply.code(202).send({ ok: true, ignored: true });
      const { apiKey } = JSON.parse(decryptSecret(lookup[0]!.encrypted)) as { apiKey: string };
      const provider = makeProvider('brevo', { apiKey });
      try {
        provider.verifyWebhook(raw, signature);
      } catch {
        return reply.code(401).send({ code: 'BAD_SIGNATURE' });
      }
      const ev = provider.parseWebhook(raw);
      await processProviderEvent(db, lookup[0]!.orgId, 'brevo', ev);
      return { ok: true };
    } finally {
      await db.$client.end?.().catch(() => undefined);
    }
  });
}

type _D = ReturnType<typeof createDb>;
async function processProviderEvent(
  db: _D,
  organizationId: string,
  provider: 'resend' | 'brevo',
  ev: _EW,
) {
  // Idempotent: write a message_event, dedupe by (provider, providerMessageId, kind).
  const existing = (await db
    .select({ id: schema.messageEvents.id })
    .from(schema.messageEvents)
    .where(and(
      eq(schema.messageEvents.organizationId, organizationId),
      eq(schema.messageEvents.providerMessageId, ev.providerMessageId),
      eq(schema.messageEvents.kind, ev.kind),
    ))
    .limit(1))[0];
  if (existing) return;
  const id = generateId('mevt');
  await db.insert(schema.messageEvents).values({
    id,
    organizationId,
    provider,
    providerMessageId: ev.providerMessageId,
    kind: ev.kind,
    contactId: '',
    senderId: '',
    payload: ev.details ?? {},
  });
  // Hard bounce / complaint → suppress the recipient for the future.
  if (ev.kind === 'bounced' || ev.kind === 'complained') {
    if (ev.recipient) {
      await db
        .insert(schema.suppressions)
        .values({
          id: generateId('supp'),
          organizationId,
          email: ev.recipient,
          reason: ev.kind === 'bounced' ? 'hard_bounce' : 'complaint',
          source: `webhook_${provider}`,
        })
        .onConflictDoUpdate({
          target: [schema.suppressions.organizationId, schema.suppressions.email],
          set: { reason: ev.kind === 'bounced' ? 'hard_bounce' : 'complaint' },
        });
    }
  }
  if (ev.kind === 'unsubscribed' && ev.recipient) {
    await db
      .insert(schema.suppressions)
      .values({
        id: generateId('supp'),
        organizationId,
        email: ev.recipient,
        reason: 'unsubscribed',
        source: `webhook_${provider}`,
      })
      .onConflictDoUpdate({
        target: [schema.suppressions.organizationId, schema.suppressions.email],
        set: { reason: 'unsubscribed' },
      });
  }
}
