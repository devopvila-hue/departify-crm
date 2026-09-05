import { createCipheriv, createDecipheriv, createHash, randomBytes, createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * Symmetric envelope encryption for provider credentials.
 *
 * Key derivation: SHA-256(ENCRYPTION_KEY) → 32 bytes, used directly as
 * the AES-256-GCM key. Output format (base64):
 *
 *   iv(12B) || tag(16B) || ciphertext
 *
 * We never return the plaintext to the client. The encrypted blob is
 * stored in `email_senders.credentials_encrypted` and decrypted on demand
 * inside the provider adapter.
 */
function key(): Buffer {
  return createHash('sha256').update(config.ENCRYPTION_KEY).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('encrypted payload too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** SHA-256 → hex; used to index API keys + session tokens at rest. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Opaque session/API token, 32 random bytes URL-safe. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacSha256(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}
