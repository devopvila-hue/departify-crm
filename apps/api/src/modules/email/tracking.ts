/**
 * Email open + click tracking.
 *
 * The worker rewrites every outgoing email to:
 *   - inject a 1x1 tracking pixel at the end of the HTML body
 *   - rewrite every link in the body so it goes through `/track/click/:eventId?url=...`
 *
 * Both endpoints record a `message_event` with the appropriate `kind`
 * (`opened` or `clicked`) so the UI can show real-time engagement
 * on the contact timeline.
 *
 * Privacy: tracking only fires for emails we sent and we only record
 * the first open per event-id; subsequent opens are silently
 * absorbed to keep the timeline clean.
 */
import { and, eq } from 'drizzle-orm';
import { generateId, Prefixes, type EmailEventKind } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import { config } from '../../config.js';

const PIXEL_PNG_BASE64 =
  // 1x1 transparent PNG, the de-facto email tracking pixel.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface TrackUrls {
  open: string;
  click: (rawUrl: string) => string;
}

export function trackUrlsFor(eventId: string): TrackUrls {
  const base = config.PUBLIC_HOSTNAME.startsWith('http')
    ? config.PUBLIC_HOSTNAME
    : `https://${config.PUBLIC_HOSTNAME}`;
  return {
    open: `${base}/api/v1/track/open/${eventId}.png`,
    click: (rawUrl) => `${base}/api/v1/track/click/${eventId}?url=${encodeURIComponent(rawUrl)}`,
  };
}

/** Inject a tracking pixel and rewrite links. Returns the new body. */
export function injectTracking(html: string, eventId: string): string {
  const urls = trackUrlsFor(eventId);
  // Rewrite every href to go through the click tracker. We deliberately
  // only touch href="…" to avoid corrupting inline styles or scripts.
  const rewritten = html.replace(
    /href\s*=\s*"([^"]+)"/gi,
    (match, raw) => {
      if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('#')) {
        return match;
      }
      return `href="${urls.click(raw)}"`;
    },
  );
  const pixel = `<img src="${urls.open}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px" />`;
  // Prefer inserting just before </body>; otherwise append at the end.
  if (/<\/body>/i.test(rewritten)) {
    return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${rewritten}${pixel}`;
}

/** Record an open or click event. Idempotent per (org, eventId, kind). */
export async function recordEngagement(
  db: Database,
  orgId: string,
  eventId: string,
  contactId: string,
  senderId: string | null,
  enrollmentId: string | null,
  kind: EmailEventKind,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  const dedupe = await db
    .select({ id: schema.messageEvents.id })
    .from(schema.messageEvents)
    .where(and(
      eq(schema.messageEvents.organizationId, orgId),
      eq(schema.messageEvents.providerMessageId, eventId),
      eq(schema.messageEvents.kind, kind),
    ))
    .limit(1);
  if (dedupe[0]) return false;
  const id = generateId(Prefixes.messageEvent);
  await db.insert(schema.messageEvents).values({
    id,
    organizationId: orgId,
    enrollmentId,
    contactId,
    senderId,
    provider: 'fake',
    providerMessageId: eventId,
    kind,
    payload,
  });
  return true;
}

export { PIXEL_PNG_BASE64 };
