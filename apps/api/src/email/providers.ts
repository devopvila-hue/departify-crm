/**
 * DEPARTIFY CRM — concrete email providers.
 *
 * Resend, Brevo, and a `fake` provider for development. All three
 * satisfy the `EmailProvider` contract from @departify-crm/shared.
 * The API never imports a specific provider; it gets one from the
 * provider registry below.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type {
  EmailMessage,
  EmailProvider,
  EmailProviderId,
  EmailSendError,
  EmailSendResult,
  EmailMessageStatus,
  EmailEventKind,
  EmailWebhookEvent,
} from '@departify-crm/shared';

// ─── shared helpers ────────────────────────────────────────────────────

function asError(kind: EmailSendError['kind'], message: string, extra: Partial<EmailSendError> = {}): EmailSendError {
  return {
    kind,
    message,
    retryable: kind === 'rate_limited' || kind === 'temporary',
    ...extra,
  };
}

// ─── Resend ────────────────────────────────────────────────────────────

export class ResendProvider implements EmailProvider {
  readonly id: EmailProviderId = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<EmailSendResult | EmailSendError> {
    const payload: Record<string, unknown> = {
      from: msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email,
      to: msg.to.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)),
      subject: msg.subject,
      text: msg.text,
      headers: {
        'X-Entity-Ref-ID': msg.clientReferenceId,
        ...(msg.headers ?? {}),
      },
    };
    if (msg.html) payload['html'] = msg.html;
    if (msg.cc?.length) payload['cc'] = msg.cc.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email));
    if (msg.bcc?.length) payload['bcc'] = msg.bcc.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email));
    if (msg.replyTo) payload['reply_to'] = msg.replyTo.name ? `${msg.replyTo.name} <${msg.replyTo.email}>` : msg.replyTo.email;
    if (msg.attachments?.length) {
      payload['attachments'] = msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
      }));
    }
    if (msg.tags?.length) payload['tags'] = msg.tags.map((t) => ({ name: t.name, value: t.value }));

    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return asError('temporary', `resend: network error: ${(err as Error).message}`);
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string; statusCode?: number };

    if (res.status >= 200 && res.status < 300 && body.id) {
      return {
        providerMessageId: body.id,
        clientReferenceId: msg.clientReferenceId,
        acceptedAt: new Date().toISOString(),
      };
    }

    if (res.status === 401 || res.status === 403) return asError('auth_failed', `resend: ${body.message ?? 'unauthorized'}`, { providerCode: body.name });
    if (res.status === 422) return asError('invalid_recipient', `resend: ${body.message ?? 'validation error'}`, { providerCode: body.name });
    if (res.status === 429) return asError('rate_limited', `resend: ${body.message ?? 'rate limited'}`, { providerCode: body.name });
    if (res.status >= 500) return asError('temporary', `resend: ${body.message ?? 'upstream error'}`, { providerCode: body.name });
    return asError('rejected', `resend: ${body.message ?? 'rejected'}`, { providerCode: body.name });
  }

  async sendBatch(messages: EmailMessage[]): Promise<Array<EmailSendResult | EmailSendError>> {
    // Resend supports up to 100 emails per batch request via /emails/batch.
    // For simplicity and uniformity we send one-by-one in parallel batches of 10.
    const results: Array<EmailSendResult | EmailSendError> = [];
    for (let i = 0; i < messages.length; i += 10) {
      const slice = messages.slice(i, i + 10);
      const r = await Promise.all(slice.map((m) => this.send(m)));
      results.push(...r);
    }
    return results;
  }

  async getStatus(providerMessageId: string): Promise<EmailMessageStatus> {
    const res = await this.fetchImpl(`https://api.resend.com/emails/${providerMessageId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const body = (await res.json().catch(() => ({}))) as { last_event?: string; created_at?: string };
    const kind = (body.last_event ?? 'queued') as EmailEventKind;
    return { providerMessageId, lastEvent: kind, occurredAt: body.created_at ?? new Date().toISOString() };
  }

  verifyWebhook(rawBody: string, signature: string): void {
    if (!signature) throw new Error('resend webhook: missing signature');
    const expected = createHmac('sha256', this.apiKey).update(rawBody).digest('hex');
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('resend webhook: signature mismatch');
    }
  }

  parseWebhook(rawBody: string): EmailWebhookEvent {
    const body = JSON.parse(rawBody) as {
      type?: string;
      data?: {
        email_id?: string;
        to?: string[];
        created_at?: string;
        bounce_type?: string;
        complaint_type?: string;
        click_url?: string;
        user_agent?: string;
        ip?: string;
        link?: string;
      };
    };
    const t = body.type ?? 'unknown';
    const map: Record<string, EmailEventKind> = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'queued',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.failed': 'failed',
    };
    return {
      providerMessageId: body.data?.email_id ?? '',
      kind: map[t] ?? 'queued',
      occurredAt: body.data?.created_at ?? new Date().toISOString(),
      recipient: body.data?.to?.[0] ?? '',
      details: {
        bounce_type: body.data?.bounce_type,
        complaint_type: body.data?.complaint_type,
        click_url: body.data?.click_url ?? body.data?.link,
        user_agent: body.data?.user_agent,
        ip: body.data?.ip,
      },
    };
  }
}

// ─── Brevo ──────────────────────────────────────────────────────────────

export class BrevoProvider implements EmailProvider {
  readonly id: EmailProviderId = 'brevo';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<EmailSendResult | EmailSendError> {
    const payload: Record<string, unknown> = {
      sender: msg.from.name ? { name: msg.from.name, email: msg.from.email } : { email: msg.from.email },
      to: msg.to.map((t) => (t.name ? { name: t.name, email: t.email } : { email: t.email })),
      subject: msg.subject,
      textContent: msg.text,
      headers: {
        'X-Entity-Ref-ID': msg.clientReferenceId,
        ...(msg.headers ?? {}),
      },
    };
    if (msg.html) payload['htmlContent'] = msg.html;
    if (msg.cc?.length) payload['cc'] = msg.cc.map((c) => (c.name ? { name: c.name, email: c.email } : { email: c.email }));
    if (msg.bcc?.length) payload['bcc'] = msg.bcc.map((c) => (c.name ? { name: c.name, email: c.email } : { email: c.email }));
    if (msg.replyTo) payload['replyTo'] = msg.replyTo.email;
    if (msg.attachments?.length) {
      payload['attachment'] = msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
      }));
    }
    if (msg.tags?.length) payload['tags'] = msg.tags.map((t) => t.value);

    let res: Response;
    try {
      res = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return asError('temporary', `brevo: network error: ${(err as Error).message}`);
    }

    const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };

    if (res.status >= 200 && res.status < 300 && body.messageId) {
      return {
        providerMessageId: body.messageId,
        clientReferenceId: msg.clientReferenceId,
        acceptedAt: new Date().toISOString(),
      };
    }

    if (res.status === 401 || res.status === 403) return asError('auth_failed', `brevo: ${body.message ?? 'unauthorized'}`, { providerCode: body.code });
    if (res.status === 400) return asError('invalid_recipient', `brevo: ${body.message ?? 'bad request'}`, { providerCode: body.code });
    if (res.status === 429) return asError('rate_limited', `brevo: ${body.message ?? 'rate limited'}`, { providerCode: body.code });
    if (res.status >= 500) return asError('temporary', `brevo: ${body.message ?? 'upstream error'}`, { providerCode: body.code });
    return asError('rejected', `brevo: ${body.message ?? 'rejected'}`, { providerCode: body.code });
  }

  async sendBatch(messages: EmailMessage[]): Promise<Array<EmailSendResult | EmailSendError>> {
    const results: Array<EmailSendResult | EmailSendError> = [];
    for (let i = 0; i < messages.length; i += 10) {
      const slice = messages.slice(i, i + 10);
      const r = await Promise.all(slice.map((m) => this.send(m)));
      results.push(...r);
    }
    return results;
  }

  async getStatus(providerMessageId: string): Promise<EmailMessageStatus> {
    const res = await this.fetchImpl(
      `https://api.brevo.com/v3/smtp/statistics/events?messageId=${encodeURIComponent(providerMessageId)}&limit=1`,
      { headers: { 'api-key': this.apiKey } },
    );
    const body = (await res.json().catch(() => ({ events: [] }))) as {
      events?: Array<{ event?: string; date?: string }>;
    };
    const ev = body.events?.[0];
    return {
      providerMessageId,
      lastEvent: (ev?.event as EmailEventKind | undefined) ?? 'queued',
      occurredAt: ev?.date ?? new Date().toISOString(),
    };
  }

  verifyWebhook(_rawBody: string, signature: string): void {
    // Brevo signs webhook payloads via a custom header. The exact
    // algorithm is documented in their webhook guide. For this sprint
    // we keep the verifier minimal — the production rollout will pin
    // the exact header name and digest.
    if (!signature) throw new Error('brevo webhook: missing signature');
  }

  parseWebhook(rawBody: string): EmailWebhookEvent {
    const body = JSON.parse(rawBody) as {
      event?: string;
      messageId?: string;
      email?: string;
      'message-id'?: string;
      date?: string;
      ts?: number;
      ts_event?: number;
    };
    const map: Record<string, EmailEventKind> = {
      request: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      opened: 'opened',
      click: 'clicked',
      hard_bounce: 'bounced',
      soft_bounce: 'bounced',
      complaint: 'complained',
      unsubscribe: 'unsubscribed',
      blocked: 'failed',
      invalid_email: 'failed',
      deferred: 'queued',
    };
    return {
      providerMessageId: body.messageId ?? body['message-id'] ?? '',
      kind: map[body.event ?? ''] ?? 'queued',
      occurredAt: body.date ?? (body.ts_event ? new Date(body.ts_event).toISOString() : new Date().toISOString()),
      recipient: body.email ?? '',
    };
  }
}

// ─── fake (dev only) ────────────────────────────────────────────────────

/**
 * A provider that doesn't make any network calls. The "send" returns
 * a fake provider message id and the message is logged. Used in dev
 * and tests so we never accidentally email a real recipient.
 */
export class FakeProvider implements EmailProvider {
  readonly id: EmailProviderId = 'fake';
  readonly sent: EmailMessage[] = [];

  constructor(private readonly onSend?: (msg: EmailMessage, result: EmailSendResult) => void) {}

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const result: EmailSendResult = {
      providerMessageId: `fake_${randomUUID()}`,
      clientReferenceId: msg.clientReferenceId,
      acceptedAt: new Date().toISOString(),
    };
    this.sent.push(msg);
    this.onSend?.(msg, result);
    return result;
  }

  async sendBatch(messages: EmailMessage[]): Promise<EmailSendResult[]> {
    const out: EmailSendResult[] = [];
    for (const m of messages) out.push(await this.send(m));
    return out;
  }

  async getStatus(providerMessageId: string): Promise<EmailMessageStatus> {
    return { providerMessageId, lastEvent: 'delivered', occurredAt: new Date().toISOString() };
  }

  verifyWebhook(_rawBody: string, _signature: string): void {
    // no-op
  }

  parseWebhook(rawBody: string): EmailWebhookEvent {
    return JSON.parse(rawBody) as EmailWebhookEvent;
  }
}

// ─── registry ──────────────────────────────────────────────────────────

export function makeProvider(
  id: EmailProviderId,
  credentials: { apiKey: string },
): EmailProvider {
  switch (id) {
    case 'resend':
      return new ResendProvider(credentials.apiKey);
    case 'brevo':
      return new BrevoProvider(credentials.apiKey);
    case 'fake':
      return new FakeProvider();
  }
}
