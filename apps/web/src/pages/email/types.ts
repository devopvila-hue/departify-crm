/**
 * Types for the email module UI. These mirror the API contract
 * in apps/api/src/modules/email/routes.ts and
 * packages/shared/src/email.ts. Kept in one file so the UI is easy
 * to read end-to-end.
 */

export type EmailProviderId = 'resend' | 'brevo' | 'fake';
export type SenderStatus = 'active' | 'paused' | 'pending' | 'disabled';

export interface EmailSender {
  id: string;
  provider: EmailProviderId;
  name: string;
  email: string;
  replyTo: string | null;
  status: SenderStatus;
  dailyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplate {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  senderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SequenceStep =
  | { kind: 'email'; templateId?: string; senderId?: string }
  | { kind: 'wait'; waitDays?: number }
  | {
      kind: 'conditional';
      ifEvent?: 'opened' | 'clicked' | 'replied' | 'bounced';
      thenAction?: 'continue' | 'exit';
    }
  | { kind: 'exit' };

export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface Sequence {
  id: string;
  organizationId: string;
  name: string;
  senderId: string | null;
  status: SequenceStatus;
  timezone: string;
  sendingWindowStart: string;
  sendingWindowEnd: string;
  steps: SequenceStep[];
  createdAt: string;
  updatedAt: string;
}

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'exited';

export interface SequenceEnrollment {
  id: string;
  organizationId: string;
  sequenceId: string;
  contactId: string;
  currentStep: number;
  nextActionAt: string | null;
  status: EnrollmentStatus;
  exitReason: string | null;
  enrolledAt: string;
  completedAt: string | null;
}

export type SuppressionReason = 'unsubscribed' | 'hard_bounce' | 'complaint' | 'manual' | 'invalid';

export interface Suppression {
  id: string;
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  source: string | null;
  createdAt: string;
}

export type MessageEventKind =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'unsubscribed';

export interface MessageEvent {
  id: string;
  organizationId: string;
  enrollmentId: string | null;
  contactId: string;
  senderId: string | null;
  provider: EmailProviderId;
  providerMessageId: string | null;
  kind: MessageEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
}
