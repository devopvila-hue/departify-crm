/**
 * Stable string ID utilities. We use a prefixed ULID-ish format
 * (e.g. `org_01H...`) so logs and URLs are self-describing and so we
 * can later swap the implementation without breaking external contracts.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford-ish, no I/L/O/U

function timeCharAt(buf: number, i: number): string {
  // Use last 4 bits per index of the time-based random
  return ALPHABET[(buf >> (i * 2)) & 0x1f] ?? '0';
}

export function generateId(prefix: string): string {
  const time = Date.now();
  const timeBuf = Buffer.alloc(4);
  timeBuf.writeUInt32BE(time >>> 0, 0);
  let timeStr = '';
  for (let i = 0; i < 8; i++) timeStr += timeCharAt(timeBuf.readUInt32BE(0) >>> (i * 4), 0);

  const rand = randomBytes(10);
  let randStr = '';
  for (let i = 0; i < 10; i++) {
    randStr += ALPHABET[rand[i]! % ALPHABET.length];
  }

  return `${prefix}_${timeStr}${randStr}`.toLowerCase();
}

export const Prefixes = {
  organization: 'org',
  user: 'usr',
  membership: 'mem',
  contact: 'con',
  company: 'cmp',
  deal: 'deal',
  pipeline: 'pipe',
  stage: 'stg',
  tag: 'tag',
  note: 'note',
  task: 'task',
  customFieldDef: 'cfdef',
  customFieldValue: 'cfval',
  activity: 'act',
  audit: 'aud',
  session: 'ses',
  apiKey: 'ak',
  // Sprint 5: email automation
  emailSender: 'snd',
  emailTemplate: 'tpl',
  sequence: 'seq',
  sequenceEnrollment: 'enr',
  suppression: 'supp',
  messageEvent: 'mevt',
} as const;

export type IdPrefix = (typeof Prefixes)[keyof typeof Prefixes];
