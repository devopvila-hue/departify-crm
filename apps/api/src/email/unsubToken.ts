/**
 * HMAC-SHA256 signed unsubscribe tokens.
 *
 * The token encodes `email|organizationId` and a signature so a single
 * link is enough for a contact to opt out: anyone with the link can
 * unsubscribe, and the signature guarantees the email/orgId pair came
 * from us (and not from an attacker guessing an address).
 *
 * Format: `base64url(payload).base64url(signature)`. The signature is
 * `HMAC-SHA256(UNSUB_SECRET, payload)` in base64url. We don't use JWT
 * because the use case is narrow and we want zero deps.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const UNSUB_SECRET = process.env['UNSUB_SECRET'] ?? 'dev-unsub-secret-rotate-in-prod';

export function signUnsubToken(email: string, organizationId: string): string {
  const payload = `${email}|${organizationId}`;
  const sig = createHmac('sha256', UNSUB_SECRET).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

export function verifyUnsubToken(token: string): { email: string; organizationId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(body ?? '', 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', UNSUB_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [email, organizationId] = payload.split('|');
  if (!email || !organizationId) return null;
  return { email, organizationId };
}
