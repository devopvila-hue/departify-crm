/**
 * AI routes — the 10 "surprise" features exposed over HTTP and MCP.
 *
 *  HTTP  /api/v1/ai/*
 *  MCP   ai_* tools (registered in tools/ai.ts)
 *
 * All endpoints return a `configured: true|false` field so the UI
 * can show a clear "AI not configured" state without guessing.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { and, eq, desc } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { config } from '../config.js';
import { notFound, httpError } from '../errors.js';
import { ErrorCodes } from '@departify-crm/shared';
const serviceUnavailable = (message: string) => httpError(ErrorCodes.INTERNAL, message, 503);
import { requireRole } from '../tenants/plugin.js';
import { askForJson, llmConfigured, loadContactContext } from './client.js';
import { AI_BASE_SYSTEM, BUILD_LIST_PROMPT, DEAL_RISK_PROMPT, DRAFT_REPLY_PROMPT, ENRICH_PROMPT, EXTRACT_PROMPT, SCORE_PROMPT, SUMMARIZE_PROMPT } from './prompts.js';

function systemFor(orgName: string) { return AI_BASE_SYSTEM(orgName); }

function summarizeContact(contact: { firstName: string | null; lastName: string | null; jobTitle: string | null; companyId: string | null }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '(sin nombre)';
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /ai/enrich-contact ───────────────────────────────────────
  // Returns inferred jobTitle, industry, location, etc. for a contact
  // identified by name + email (optionally company).
  const EnrichBody = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().optional(),
    company: z.string().max(200).optional(),
    jobTitle: z.string().max(200).optional(),
  });

  app.post(
    '/ai/enrich-contact',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const body = EnrichBody.parse(req.body);
      const user = `Name: ${body.name}\nEmail: ${body.email ?? '—'}\nCompany: ${body.company ?? '—'}\nKnown job title: ${body.jobTitle ?? '—'}`;
      const result = await askForJson({ system: systemFor('your org'), user: `${ENRICH_PROMPT}\n\n${user}` });
      return { result };
    },
  );

  // ─── POST /ai/extract-contact ──────────────────────────────────────
  // Pasted signature / business card / notes → structured contact.
  const ExtractBody = z.object({
    text: z.string().min(3).max(10_000),
  });
  app.post(
    '/ai/extract-contact',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const body = ExtractBody.parse(req.body);
      const result = await askForJson({ system: systemFor('your org'), user: `${EXTRACT_PROMPT}\n\n${body.text}` });
      return { result };
    },
  );

  // ─── POST /ai/score-contact ────────────────────────────────────────
  const ScoreBody = z.object({ contactId: z.string() });
  app.post(
    '/ai/score-contact',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const { contactId } = ScoreBody.parse(req.body);
      const org = req.tenant!;
      const ctx = await loadContactContext(org.organizationId, contactId);
      if (!ctx || !ctx.contact) throw notFound('contact not found');
      const summary = JSON.stringify({
        contact: {
          name: summarizeContact(ctx.contact),
          jobTitle: ctx.contact.jobTitle,
          email: ctx.contact.email,
          lifecycle: ctx.contact.lifecycle,
        },
        recentActivities: ctx.recentActivities.slice(0, 5).map((a) => ({ type: a.type, title: a.title, createdAt: a.createdAt })),
        openDeals: ctx.openDeals.map((d) => ({ name: d.name, stage: d.stageId, status: d.status, valueMinor: d.valueMinor, expectedCloseAt: d.expectedCloseAt })),
        recentMessages: ctx.recentMessages.slice(0, 10).map((m) => ({ kind: m.kind, createdAt: m.createdAt })),
      }, null, 2);
      const result = await askForJson({ system: systemFor('your org'), user: `${SCORE_PROMPT}\n\n${summary}` });
      // Persist a hint on the contact so the UI can show it cheaply.
      if (result && typeof result === 'object' && 'score' in (result as Record<string, unknown>)) {
        const score = Number((result as { score: unknown }).score);
        if (Number.isFinite(score)) {
          const db = createDb(config.DATABASE_URL);
          await db
            .update(schema.contacts)
            .set({ jobTitle: ctx.contact.jobTitle ?? null, customValues: { ...(ctx.contact.customValues ?? {}), ai_score: score, ai_score_at: new Date().toISOString() } })
            .where(and(eq(schema.contacts.organizationId, org.organizationId), eq(schema.contacts.id, contactId)));
        }
      }
      return { result };
    },
  );

  // ─── GET /ai/summarize-contact ────────────────────────────────────
  app.get(
    '/ai/summarize-contact/:id',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const id = (req.params as { id: string }).id;
      const org = req.tenant!;
      const ctx = await loadContactContext(org.organizationId, id);
      if (!ctx || !ctx.contact) throw notFound('contact not found');
      const summary = JSON.stringify({
        contact: {
          name: summarizeContact(ctx.contact),
          jobTitle: ctx.contact.jobTitle,
          email: ctx.contact.email,
          companyId: ctx.contact.companyId,
        },
        recentActivities: ctx.recentActivities.slice(0, 8).map((a) => ({ type: a.type, title: a.title, createdAt: a.createdAt, body: a.body })),
        openDeals: ctx.openDeals.map((d) => ({ name: d.name, valueMinor: d.valueMinor, stage: d.stageId, expectedCloseAt: d.expectedCloseAt, updatedAt: d.updatedAt })),
        recentMessages: ctx.recentMessages.slice(0, 10).map((m) => ({ kind: m.kind, createdAt: m.createdAt })),
      }, null, 2);
      const result = await askForJson({ system: systemFor('your org'), user: `${SUMMARIZE_PROMPT}\n\n${summary}`, maxTokens: 600 });
      return { result };
    },
  );

  // ─── GET /ai/deal-risks ───────────────────────────────────────────
  app.get(
    '/ai/deal-risks',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const org = req.tenant!;
      const db = createDb(config.DATABASE_URL);
      const openDeals = await db
        .select()
        .from(schema.deals)
        .where(and(eq(schema.deals.organizationId, org.organizationId), eq(schema.deals.status, 'open')))
        .orderBy(desc(schema.deals.updatedAt))
        .limit(40);
      if (openDeals.length === 0) return { result: { risks: [] } };
      // Pull last activity date per deal.
      const lastByDeal = new Map<string, string>();
      for (const d of openDeals) {
        lastByDeal.set(d.id, (d.updatedAt as unknown as string) ?? '');
      }
      const now = Date.now();
      const trimmed = openDeals.map((d) => {
        const last = lastByDeal.get(d.id);
        const days = last ? Math.floor((now - new Date(last).getTime()) / 86_400_000) : 999;
        const daysToClose = d.expectedCloseAt ? Math.floor((new Date(d.expectedCloseAt).getTime() - now) / 86_400_000) : null;
        return {
          dealId: d.id,
          name: d.name,
          stage: d.stageId,
          valueMinor: d.valueMinor,
          currency: d.currency,
          expectedCloseAt: d.expectedCloseAt,
          daysToClose,
          daysSinceLastActivity: days,
          updatedAt: d.updatedAt,
        };
      });
      const result = await askForJson({ system: systemFor('your org'), user: `${DEAL_RISK_PROMPT}\n\nDEALS:\n${JSON.stringify(trimmed, null, 2)}`, maxTokens: 2000 });
      return { result };
    },
  );

  // ─── POST /ai/draft-reply ─────────────────────────────────────────
  const DraftBody = z.object({
    contactId: z.string(),
    context: z.string().max(2000).optional(),
  });
  app.post(
    '/ai/draft-reply',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const { contactId, context } = DraftBody.parse(req.body);
      const org = req.tenant!;
      const ctx = await loadContactContext(org.organizationId, contactId);
      if (!ctx || !ctx.contact) throw notFound('contact not found');
      const summary = JSON.stringify({
        contact: {
          name: summarizeContact(ctx.contact),
          jobTitle: ctx.contact.jobTitle,
          email: ctx.contact.email,
        },
        recentMessages: ctx.recentMessages.slice(0, 8).map((m) => ({ kind: m.kind, createdAt: m.createdAt, payload: m.payload })),
        userContext: context ?? null,
      }, null, 2);
      const result = await askForJson({ system: systemFor('your org'), user: `${DRAFT_REPLY_PROMPT}\n\n${summary}`, maxTokens: 1200 });
      return { result };
    },
  );

  // ─── POST /ai/build-list ──────────────────────────────────────────
  const ListBody = z.object({ query: z.string().min(5).max(500) });
  app.post(
    '/ai/build-list',
    { preHandler: [requireRole('member')] },
    async (req) => {
      if (!llmConfigured()) throw serviceUnavailable('LLM not configured');
      const { query } = ListBody.parse(req.body);
      const result = await askForJson({ system: systemFor('your org'), user: `${BUILD_LIST_PROMPT}\n\nUSER QUERY: ${query}` });
      return { result };
    },
  );

  // ─── GET /ai/status ───────────────────────────────────────────────
  // Tells the UI whether the LLM is wired and what model is active.
  app.get('/ai/status', { preHandler: [requireRole('member')] }, async () => {
    return {
      configured: llmConfigured(),
      model: llmConfigured() ? config.LLM_MODEL : null,
      provider: config.LLM_PROVIDER,
    };
  });
}
