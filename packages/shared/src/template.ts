/**
 * Template rendering — safe, predictable, no eval, no surprises.
 *
 * The renderer supports:
 *   {{var}}                — simple variable lookup, path-style with dot.
 *   {{var | default}}      — missing variable falls back to the literal default.
 *   {{var | upper}}         — built-in string filter.
 *   {{var | lower}}         — built-in string filter.
 *   {{var | trim}}          — built-in string filter.
 *
 * Anything else is left untouched, so an email author can write a real
 * `{{` if they want to, by escaping with `{{ "{{" }}` (we just leave it).
 *
 * Missing variables always render as empty string by default. This
 * means a broken merge field doesn't break the whole send — the email
 * just looks slightly off and the worker logs the miss.
 */
import type { TemplateContext } from './email.js';

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)(?:\s*\|\s*([a-zA-Z]+))?(?:\s*\|\s*default\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)")?\s*\}\}/g;
const TRIPLE_VAR_RE = /\{\{\s*\{\{\s*\}\}\s*\}\}/g;

const FILTERS: Record<string, (s: string) => string> = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
};

function getPath(ctx: TemplateContext, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function renderTemplateString(input: string, ctx: TemplateContext): string {
  // Allow `{{ "{{" }}` to render as a literal `{{`.
  const normalized = input.replace(TRIPLE_VAR_RE, '{{');

  return normalized.replace(VAR_RE, (_match, varName: string, filter: string | undefined, defaultValue: string | undefined) => {
    const value = getPath(ctx, varName);
    let str: string;
    if (value === undefined || value === null) {
      str = defaultValue !== undefined ? defaultValue : '';
    } else if (typeof value === 'object') {
      str = JSON.stringify(value);
    } else {
      str = String(value);
    }
    if (filter && FILTERS[filter]) {
      str = FILTERS[filter](str);
    }
    return str;
  });
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}

export interface RenderInput {
  subject: string;
  text: string;
  html?: string;
}

export function renderEmail(input: RenderInput, ctx: TemplateContext): RenderedEmail {
  return {
    subject: renderTemplateString(input.subject, ctx),
    text: renderTemplateString(input.text, ctx),
    html: input.html ? renderTemplateString(input.html, ctx) : undefined,
  };
}

/** Build a sample context for a contact so the UI can show a preview. */
export function previewContext(args: {
  contact: { firstName?: string; lastName?: string; fullName?: string; email?: string; jobTitle?: string };
  organization: { name?: string };
  sender: { name?: string; email?: string };
}): TemplateContext {
  const today = new Date().toISOString().slice(0, 10);
  return {
    today,
    contact: {
      first_name: args.contact.firstName ?? 'Lucía',
      last_name: args.contact.lastName ?? 'Vidal',
      full_name: args.contact.fullName ?? 'Lucía Vidal',
      email: args.contact.email ?? 'lucia@example.test',
      job_title: args.contact.jobTitle ?? 'CEO',
    },
    organization: { name: args.organization.name ?? 'Tu Empresa' },
    sender: {
      name: args.sender.name ?? 'Tu equipo',
      email: args.sender.email ?? 'hola@tuempresa.test',
    },
  };
}
