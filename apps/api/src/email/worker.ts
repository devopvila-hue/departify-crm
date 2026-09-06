/**
 * DEPARTIFY CRM — Sequence worker
 *
 * Single in-process loop. Picks up due enrollments with
 * `FOR UPDATE SKIP LOCKED`, advances the step, sends (or waits),
 * writes a message_event. Restart-safe: if the process dies
 * mid-step, the row is still locked-or-rolled-back and another
 * process (or this one on next boot) picks it up.
 *
 * For sprint 5 this is an in-process loop started alongside the API.
 * In a real deploy with multiple replicas you'd run it as a separate
 * service via `pnpm worker` — the loop is independent of HTTP.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, renderEmail, type EmailEventKind, type EmailSendError, type EmailSendResult } from '@departify-crm/shared';
import { decryptSecret } from '../lib/crypto.js';
import { makeProvider } from './providers.js';

const POLL_INTERVAL_MS = 2_000;
const MAX_BATCH = 25;

let stopped = false;

export function stopWorker() {
  stopped = true;
}

export async function runWorker(databaseUrl: string, opts: { once?: boolean } = {}): Promise<void> {
  const db = createDb(databaseUrl);
  console.log('[worker] started; pid', process.pid);
  while (!stopped) {
    try {
      const processed = await tickOnce(db);
      if (opts.once) {
        console.log('[worker] once=true; processed', processed);
        await db.$client.end?.().catch(() => undefined);
        return;
      }
      if (processed === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[worker] error', err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  await db.$client.end?.().catch(() => undefined);
  console.log('[worker] stopped');
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type Step = {
  kind: 'email' | 'wait' | 'conditional' | 'exit';
  templateId?: string;
  senderId?: string;
  waitDays?: number;
  ifEvent?: 'opened' | 'clicked' | 'replied' | 'bounced';
  thenAction?: 'continue' | 'exit';
};

export async function tickOnce(db: ReturnType<typeof createDb>): Promise<number> {
  // Pick up to MAX_BATCH due enrollments. We use a single SQL
  // statement with FOR UPDATE SKIP LOCKED inside a transaction so
  // concurrent workers (or restarts) don't double-claim.
  return db.transaction(async (tx) => {
    const due = await tx.execute<{
      enrollment_id: string;
      organization_id: string;
      sequence_id: string;
      contact_id: string;
      current_step: number;
      next_action_at: Date;
    }>(sql`
      SELECT id AS enrollment_id, organization_id, sequence_id, contact_id,
             current_step, next_action_at
        FROM sequence_enrollments
       WHERE status = 'active'
         AND next_action_at <= now()
       ORDER BY next_action_at ASC
       LIMIT ${MAX_BATCH}
       FOR UPDATE SKIP LOCKED
    `);
    const rows = (due as unknown as Array<{ enrollment_id: string; organization_id: string; sequence_id: string; contact_id: string; current_step: number; next_action_at: Date | string }>);
    if (!rows.length) return 0;

    for (const r of rows) {
      await processOne(tx, r);
    }
    return rows.length;
  });
}

async function processOne(
  tx: any,
  row: {
    enrollment_id: string;
    organization_id: string;
    sequence_id: string;
    contact_id: string;
    current_step: number;
    next_action_at: Date | string;
  },
) {
  // Load sequence + contact + sender + template in one round trip.
  const seq = (await tx
    .select()
    .from(schema.sequences)
    .where(eq(schema.sequences.id, row.sequence_id))
    .limit(1))[0];
  if (!seq) {
    await exitEnrollment(tx, row.enrollment_id, 'sequence_deleted');
    return;
  }
  const contact = (await tx
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, row.contact_id))
    .limit(1))[0];
  if (!contact) {
    await exitEnrollment(tx, row.enrollment_id, 'contact_deleted');
    return;
  }
  if (!contact.email) {
    await exitEnrollment(tx, row.enrollment_id, 'no_email');
    return;
  }
  // Re-check suppression at send time (a contact may have been
  // suppressed between enrollment and now).
  const sup = (await tx
    .select({ id: schema.suppressions.id })
    .from(schema.suppressions)
    .where(and(
      eq(schema.suppressions.organizationId, row.organization_id),
      eq(schema.suppressions.email, contact.email),
    ))
    .limit(1))[0];
  if (sup) {
    await exitEnrollment(tx, row.enrollment_id, 'suppressed');
    return;
  }

  const steps = (seq.steps as unknown as Step[]) ?? [];
  const step = steps[row.current_step];
  if (!step) {
    // Out of steps → completed.
    await tx
      .update(schema.sequenceEnrollments)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(schema.sequenceEnrollments.id, row.enrollment_id));
    return;
  }

  if (step.kind === 'wait') {
    const days = step.waitDays ?? 1;
    const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await advanceTo(tx, row.enrollment_id, row.current_step + 1, next);
    return;
  }
  if (step.kind === 'exit') {
    await exitEnrollment(tx, row.enrollment_id, 'sequence_exit_step');
    return;
  }
  if (step.kind === 'conditional') {
    // Check the latest event for this contact + this sequence to
    // see if the condition has been met.
    const last = (await tx
      .select({ kind: schema.messageEvents.kind })
      .from(schema.messageEvents)
      .where(and(
        eq(schema.messageEvents.organizationId, row.organization_id),
        eq(schema.messageEvents.contactId, row.contact_id),
      ))
      .orderBy(asc(schema.messageEvents.createdAt)))
      .slice(-1)[0];
    const lastKind: EmailEventKind | undefined = last?.kind as EmailEventKind | undefined;
    const matched = step.ifEvent && lastKind === step.ifEvent;
    if (step.thenAction === 'exit') {
      if (matched) {
        await exitEnrollment(tx, row.enrollment_id, `conditional_${step.ifEvent}_exit`);
      } else {
        await advanceTo(tx, row.enrollment_id, row.current_step + 1, new Date());
      }
      return;
    }
    // 'continue' or default
    await advanceTo(tx, row.enrollment_id, row.current_step + 1, new Date());
    return;
  }

  if (step.kind === 'email') {
    if (!step.templateId || !step.senderId) {
      await exitEnrollment(tx, row.enrollment_id, 'misconfigured_step');
      return;
    }
    const tpl = (await tx
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.id, step.templateId))
      .limit(1))[0];
    if (!tpl) {
      await exitEnrollment(tx, row.enrollment_id, 'template_deleted');
      return;
    }
    const sender = (await tx
      .select()
      .from(schema.emailSenders)
      .where(eq(schema.emailSenders.id, step.senderId))
      .limit(1))[0];
    if (!sender || sender.status !== 'active') {
      await exitEnrollment(tx, row.enrollment_id, 'sender_inactive');
      return;
    }

    // Look up the organization to render context vars.
    const org = (await tx
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, row.organization_id))
      .limit(1))[0];

    const rendered = renderEmail(
      { subject: tpl.subject, text: tpl.body, html: tpl.htmlBody ?? undefined },
      {
        today: new Date().toISOString().slice(0, 10),
        contact: {
          first_name: contact.firstName ?? '',
          last_name: contact.lastName ?? '',
          full_name: contact.fullName,
          email: contact.email ?? '',
          job_title: contact.jobTitle ?? '',
        },
        organization: { name: org?.name ?? 'Tu Empresa' },
        sender: { name: sender.name, email: sender.email },
      },
    );

    // Mint a fresh unsubscribe token for this recipient. We need an
    // internal call to the API's /unsubscribe/_sign endpoint or we
    // just sign it inline here (same algorithm). For simplicity we
    // sign inline.
    const unsubToken = signUnsubToken(contact.email!, row.organization_id);
    const unsubUrl = `https://${process.env['PUBLIC_HOSTNAME'] ?? 'departify-crm-production.up.railway.app'}/unsubscribe/${unsubToken}`;
    const htmlWithUnsub = injectUnsubscribe(rendered.html ?? '', unsubUrl);
    const textWithUnsub = `${rendered.text}\n\n— Cancelar suscripción: ${unsubUrl}`;

    // Inject open/click tracking on the HTML body. The text body
    // can't carry a pixel; we leave it as-is. messageId is generated
    // after the provider is built because we want a stable id that
    // both the tracking endpoints and the message_event row share.
    // (See below.)
    const messageId = generateId('msg');

    // Build the provider and send. For the 'fake' provider, we use
    // the credentials that the sender was created with. Real
    // providers need a decrypted API key.
    let apiKey = '';
    if (sender.provider !== 'fake') {
      const creds = JSON.parse(decryptSecret(sender.credentialsEncrypted)) as { apiKey: string };
      apiKey = creds.apiKey;
    }
    const provider = makeProvider(sender.provider, { apiKey });
    // Inject open/click tracking right before sending. messageId is
    // stable across this call so the tracking pixel and the recorded
    // message_event both refer to the same id.
    const trackedHtml = injectTracking(htmlWithUnsub, messageId);
    const result = await provider.send({
      from: { name: sender.name, email: sender.email },
      to: [{ email: contact.email! }],
      replyTo: sender.replyTo ? { email: sender.replyTo } : undefined,
      subject: rendered.subject,
      text: textWithUnsub,
      html: trackedHtml || undefined,
      clientReferenceId: `${row.enrollment_id}:${row.current_step}:${messageId}`,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'sequence_id', value: seq.id },
        { name: 'enrollment_id', value: row.enrollment_id },
      ],
    });

    // Type-discriminated branch: success has `providerMessageId`,
    // error has `kind` + `retryable`. We use explicit checks so the
    // narrowing is clear and survives the union type correctly.
    const isError = !('providerMessageId' in result);
    const err = isError ? (result as EmailSendError) : null;
    const ok = !isError ? (result as EmailSendResult) : null;

    // Record the message_event regardless of result. On success
    // we store the providerMessageId so the webhook can update it.
    await tx.insert(schema.messageEvents).values({
      id: messageId,
      organizationId: row.organization_id,
      enrollmentId: row.enrollment_id,
      contactId: row.contact_id,
      senderId: sender.id,
      provider: sender.provider,
      providerMessageId: ok?.providerMessageId ?? '',
      kind: isError ? 'failed' : 'sent',
      payload: isError ? { error: err } : { providerMessageId: ok?.providerMessageId },
    });

    if (isError && err) {
      // Permanent errors → exit. Transient → back off.
      if (err.kind === 'rejected' || err.kind === 'invalid_recipient' || err.kind === 'auth_failed') {
        await exitEnrollment(tx, row.enrollment_id, `send_${err.kind}`);
      } else if (err.kind === 'unsupported') {
        await exitEnrollment(tx, row.enrollment_id, 'send_unsupported');
      } else {
        // transient / rate_limited: bump next_action_at by exponential backoff.
        const backoffMs = computeBackoff(row.current_step);
        await advanceTo(tx, row.enrollment_id, row.current_step, new Date(Date.now() + backoffMs));
      }
      return;
    }

    // Success → advance one step. The next step (if wait) will set
    // the proper delay; if it's an email we go immediately.
    const nextStep = steps[row.current_step + 1];
    let nextAt: Date = new Date();
    if (nextStep?.kind === 'wait') {
      nextAt = new Date(Date.now() + (nextStep.waitDays ?? 1) * 24 * 60 * 60 * 1000);
    }
    await advanceTo(tx, row.enrollment_id, row.current_step + 1, nextAt);
  }
}

async function advanceTo(tx: any, enrollmentId: string, currentStep: number, nextActionAt: Date) {
  await tx
    .update(schema.sequenceEnrollments)
    .set({ currentStep, nextActionAt })
    .where(eq(schema.sequenceEnrollments.id, enrollmentId));
}

async function exitEnrollment(tx: any, enrollmentId: string, reason: string) {
  await tx
    .update(schema.sequenceEnrollments)
    .set({ status: 'exited', exitReason: reason, completedAt: new Date() })
    .where(eq(schema.sequenceEnrollments.id, enrollmentId));
}

function computeBackoff(step: number): number {
  // Exponential: 1m, 5m, 30m, 2h, 6h, capped at 6h.
  const steps = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
  return steps[Math.min(step, steps.length - 1)]!;
}

// ─── unsubscribe token signing (uses the shared module) ────────────────

import { signUnsubToken } from './unsubToken.js';
import { injectTracking } from '../modules/email/tracking.js';

function injectUnsubscribe(html: string, url: string): string {
  // The simplest thing that always renders: a footer link. If the
  // template already has a {{unsubscribe_url}} placeholder, replace
  // it; otherwise append a footer.
  if (html.includes('{{unsubscribe_url}}')) {
    return html.replace(/\{\{unsubscribe_url\}\}/g, url);
  }
  return `${html}<hr style="margin-top:2rem;border:0;border-top:1px solid #e5e5e5;" /><p style="font-size:12px;color:#888;">Si prefieres no recibir más emails, <a href="${url}">cancela tu suscripción aquí</a>.</p>`;
}
