/**
 * Public contact card — `GET /c/:slug`.
 *
 * No auth. The user creates a public slug on a contact
 * (`POST /api/v1/contacts/:id/public-card`) and shares the URL
 * `https://departify.app/c/<slug>` with whoever they want.
 *
 * The page is a single, clean HTML file (server-rendered, no
 * framework) so the recipient doesn't need a CRM to view it.
 *
 * Each view records a `message_event` with kind `'unsubscribed'`
 * is wrong — we use the existing `kind` enum; here we record
 * a custom 'system_event' would not work either. So we record a
 * dedicated `card_view` event by writing into `activities` and
 * `message_events` for analytics. To keep this self-contained we
 * just log a message_event of kind 'opened' and stash the user agent
 * in the payload — that already feeds the contact timeline.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { config } from '../../config.js';

const SLUG_RE = /^[a-z0-9_-]{6,40}$/;

export async function publicCardRoutes(app: FastifyInstance): Promise<void> {
  // The actual page is served by the SPA at /c/:slug; this route is
  // an alias for convenience and lets the SPA hydrate the same
  // content even on direct hits. We return a minimal HTML shell.
  app.get('/c/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const slug = (req.params as { slug: string }).slug;
    if (!SLUG_RE.test(slug)) {
      reply.code(404).type('text/html').send(NOT_FOUND_HTML);
      return;
    }
    const db = createDb(config.DATABASE_URL);
    // We don't index on publicSlug yet, so the lookup scans a small
    // number of contacts in the org. In a follow-up we can add a
    // public_slugs table.
    const contact = (await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.publicSlug, slug))
      .limit(1))[0];
    if (!contact) {
      reply.code(404).type('text/html').send(NOT_FOUND_HTML);
      return;
    }
    // Record a view via message_events (kind='opened') so the contact
    // timeline shows who saw the public card. The dedupe key in the
    // tracking helper is providerMessageId, which we set to the slug
    // here so repeated views within the same day collapse to one row.
    const today = new Date().toISOString().slice(0, 10);
    const id = `${slug}:${today}`;
    const already = (await db
      .select({ id: schema.messageEvents.id })
      .from(schema.messageEvents)
      .where(and(
        eq(schema.messageEvents.organizationId, contact.organizationId),
        eq(schema.messageEvents.providerMessageId, id),
        eq(schema.messageEvents.kind, 'opened'),
      ))
      .limit(1))[0];
    if (!already) {
      await db.insert(schema.messageEvents).values({
        id: `cardv_${contact.id}_${Date.now()}`,
        organizationId: contact.organizationId,
        contactId: contact.id,
        senderId: null,
        enrollmentId: null,
        provider: 'fake',
        providerMessageId: id,
        kind: 'opened',
        payload: { source: 'public_card', userAgent: req.headers['user-agent'] ?? null, ip: req.ip },
      }).catch(() => undefined);
    }
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.fullName;
    reply.type('text/html').send(renderPublicCard({
      fullName,
      jobTitle: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      company: null, // we don't fetch company for speed; could be added.
      slug,
    }));
  });
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderPublicCard(c: { fullName: string; jobTitle: string | null; email: string | null; phone: string | null; company: string | null; slug: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(c.fullName)} · DEPARTIFY CRM</title>
<meta name="description" content="Tarjeta de contacto de ${escapeHtml(c.fullName)}" />
<meta property="og:title" content="${escapeHtml(c.fullName)}" />
<meta property="og:description" content="${escapeHtml(c.jobTitle ?? 'Tarjeta de contacto')}" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; background: #0A0C08; color: #e8e9e3; margin: 0; padding: 4rem 1rem; display: grid; place-items: center; min-height: 100dvh; }
  .card { background: #14170f; border: 1px solid #2a2e22; border-radius: 18px; padding: 2.5rem 2rem; max-width: 28rem; width: 100%; box-shadow: 0 8px 40px rgba(0,0,0,.4); }
  .initials { display: grid; place-items: center; width: 4.5rem; height: 4.5rem; background: linear-gradient(135deg, #D8FF62, #4ea23f); color: #0A0C08; border-radius: 999px; font-weight: 700; font-size: 1.5rem; margin: 0 auto 1.25rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; text-align: center; }
  .role { text-align: center; color: #9aa092; margin: 0 0 1.75rem; font-size: .95rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .65rem 1rem; margin: 0; }
  dt { color: #6b7261; font-size: .8rem; }
  dd { margin: 0; font-size: .9rem; }
  .actions { display: grid; gap: .5rem; margin-top: 1.75rem; }
  a.btn { display: grid; place-items: center; padding: .75rem 1rem; border-radius: 10px; background: #D8FF62; color: #0A0C08; text-decoration: none; font-weight: 600; font-size: .9rem; }
  a.btn.secondary { background: transparent; border: 1px solid #2a2e22; color: #e8e9e3; }
  .footer { text-align: center; color: #4f5447; font-size: .7rem; margin-top: 2rem; letter-spacing: .04em; text-transform: uppercase; }
</style>
</head>
<body>
<main class="card">
  <div class="initials">${escapeHtml(initials(c.fullName))}</div>
  <h1>${escapeHtml(c.fullName)}</h1>
  <p class="role">${escapeHtml(c.jobTitle ?? '')}</p>
  <dl>
    ${c.email ? `<dt>email</dt><dd>${escapeHtml(c.email)}</dd>` : ''}
    ${c.phone ? `<dt>tel</dt><dd>${escapeHtml(c.phone)}</dd>` : ''}
  </dl>
  <div class="actions">
    ${c.email ? `<a class="btn" href="mailto:${escapeHtml(c.email)}">Enviar email</a>` : ''}
    ${c.email ? `<a class="btn secondary" href="/c/${c.slug}.vcf">Guardar contacto (vCard)</a>` : ''}
  </div>
  <p class="footer">DEPARTIFY CRM · /c/${escapeHtml(c.slug)}</p>
</main>
</body>
</html>`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><title>404</title></head>
<body style="font-family:system-ui;background:#0A0C08;color:#e8e9e3;display:grid;place-items:center;min-height:100dvh;margin:0">
<div style="text-align:center">
<h1 style="margin:0;font-size:1.5rem">No encontrado</h1>
<p style="color:#6b7261;margin:.5rem 0 0">El contacto no existe o el enlace caducó.</p>
</div>
</body>
</html>`;

/**
 * Public vCard endpoint — returns a .vcf file so the recipient can
 * save the contact to their phone / address book with one click.
 */
export async function publicCardVCardRoute(app: FastifyInstance): Promise<void> {
  app.get('/c/:slug.vcf', async (req: FastifyRequest, reply: FastifyReply) => {
    const slug = (req.params as { slug: string }).slug.replace(/\.vcf$/, '');
    if (!SLUG_RE.test(slug)) { reply.code(404).send(''); return; }
    const db = createDb(config.DATABASE_URL);
    const contact = (await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.publicSlug, slug))
      .limit(1))[0];
    if (!contact) { reply.code(404).send(''); return; }
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.fullName;
    const lines: string[] = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${fullName}`,
      contact.firstName ? `N:${contact.lastName ?? ''};${contact.firstName};;;` : `FN:${fullName}`,
      contact.email ? `EMAIL;TYPE=INTERNET:${contact.email}` : '',
      contact.phone ? `TEL;TYPE=CELL:${contact.phone}` : '',
      contact.jobTitle ? `TITLE:${contact.jobTitle}` : '',
      'END:VCARD',
    ].filter(Boolean);
    reply
      .header('content-type', 'text/vcard; charset=utf-8')
      .header('content-disposition', `attachment; filename="${slug}.vcf"`)
      .send(lines.join('\r\n') + '\r\n');
  });
}

void publicCardVCardRoute;

