/**
 * DEPARTIFY CRM — email provider contract
 *
 * Every concrete provider (Resend, Brevo, fake, ...) implements this
 * interface. The application code never imports a provider directly:
 * it only depends on the contract. This makes adding a new provider
 * a one-file change in apps/api/src/email/ and zero changes elsewhere.
 *
 * Hard rules encoded in this contract:
 *   - Sending is idempotent at the application level via
 *     `clientReferenceId` (provider message ID resolution).
 *   - Every send is non-blocking from the caller's perspective: the
 *     provider returns a transport id and a future delivery status
 *     comes back via webhook.
 *   - Errors are typed so the worker can branch on category and pick
 *     the right backoff.
 */
export type EmailAddress = string; // RFC 5321

export interface EmailAttachment {
  filename: string;
  /** base64-encoded content. We deliberately don't accept streams in
   * the contract because they don't survive the serialization layer. */
  contentBase64: string;
  contentType: string;
}

export interface EmailMessage {
  from: { email: EmailAddress; name?: string };
  to: Array<{ email: EmailAddress; name?: string }>;
  cc?: Array<{ email: EmailAddress; name?: string }>;
  bcc?: Array<{ email: EmailAddress; name?: string }>;
  replyTo?: { email: EmailAddress; name?: string };
  subject: string;
  /** Plain text alternative. Required for spam-score reasons. */
  text: string;
  /** HTML body. May be empty if the message is plain-text only. */
  html?: string;
  /** Application-level id used to dedupe and to resolve the transport id. */
  clientReferenceId: string;
  attachments?: EmailAttachment[];
  /** Per-message headers. Used for List-Unsubscribe etc. */
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export type EmailProviderId = 'resend' | 'brevo' | 'fake';

export interface EmailSendResult {
  /** Provider-side message id. Used to match webhooks back to sends. */
  providerMessageId: string;
  /** The id we sent. Echoed back for convenience. */
  clientReferenceId: string;
  /** ISO 8601 timestamp of when the provider accepted the message. */
  acceptedAt: string;
}

export type EmailSendErrorKind =
  | 'invalid_recipient'
  | 'rejected' // 4xx, will not retry
  | 'rate_limited' // 429, retry with backoff
  | 'auth_failed' // 401/403, needs human attention
  | 'suppressed' // recipient is on the local suppression list
  | 'temporary' // 5xx or network, retry
  | 'unsupported'; // provider can't do this; route to another

export interface EmailSendError {
  kind: EmailSendErrorKind;
  message: string;
  /** Provider's own code if it has one (e.g. Resend's `code` field). */
  providerCode?: string;
  /** True if this exact recipient+message should be retried. */
  retryable: boolean;
}

export interface EmailProvider {
  readonly id: EmailProviderId;
  /** Send a single message. Throws only on programmer error. Returns
   * a structured result or a structured error. */
  send(msg: EmailMessage): Promise<EmailSendResult | EmailSendError>;
  /** Best-effort batch send. Default implementation sends one by one. */
  sendBatch(messages: EmailMessage[]): Promise<Array<EmailSendResult | EmailSendError>>;
  /** Look up the current status of a previously sent message. */
  getStatus(providerMessageId: string): Promise<EmailMessageStatus>;
  /** Verify a webhook payload's signature. Throws if invalid. */
  verifyWebhook(rawBody: string, signature: string): void;
  /** Parse a webhook into the normalised event shape. */
  parseWebhook(rawBody: string): EmailWebhookEvent;
}

export type EmailEventKind =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'unsubscribed';

export interface EmailWebhookEvent {
  providerMessageId: string;
  kind: EmailEventKind;
  /** ISO 8601 timestamp from the provider. */
  occurredAt: string;
  recipient: EmailAddress;
  /** Provider-specific extra fields, normalized. */
  details?: Record<string, unknown>;
}

export interface EmailMessageStatus {
  providerMessageId: string;
  /** Last known status from the provider. */
  lastEvent: EmailEventKind;
  occurredAt: string;
}

/**
 * Variables used to render a template's `{{var}}` placeholders. Names
 * are dot-separated paths into the contact and the organization, plus
 * a few CRM-defined helpers (today, sender name, etc.).
 */
export type TemplateContext = Record<string, unknown>;
