/**
 * MCP tools — AI features.
 *
 * Mirrors the /api/v1/ai/* routes so any MCP client (MiniMax, Claude,
 * etc.) can call the same intelligence that the SPA uses. Every
 * tool returns a JSON object (or { error }) and never throws.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createDb, schema, type Database } from '@departify-crm/db';
import { config } from '../../config.js';
import type { McpOrgContext } from '../auth.js';
import { askForJson, llmConfigured, loadContactContext } from '../../ai/client.js';
import { ENRICH_PROMPT, EXTRACT_PROMPT, SCORE_PROMPT, SUMMARIZE_PROMPT, DRAFT_REPLY_PROMPT, BUILD_LIST_PROMPT, DEAL_RISK_PROMPT, AI_BASE_SYSTEM } from '../../ai/prompts.js';
import { errOut, jsonOut } from './_out.js';

function system() { return AI_BASE_SYSTEM('your org'); }

export function registerAiTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool(
    'ai_enrich_contact',
    'Infer job title, industry, location, suggested tags etc. from a contact name+email. Returns a structured object.',
    {
      name: z.string(),
      email: z.string().optional(),
      company: z.string().optional(),
      jobTitle: z.string().optional(),
    },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const user = `Name: ${a.name}\nEmail: ${a.email ?? '—'}\nCompany: ${a.company ?? '—'}\nKnown job title: ${a.jobTitle ?? '—'}`;
      const result = await askForJson({ system: system(), user: `${ENRICH_PROMPT}\n\n${user}` });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_extract_contact',
    'Parse a free-text blob (email signature, business card, notes) into structured contact fields.',
    { text: z.string() },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const result = await askForJson({ system: system(), user: `${EXTRACT_PROMPT}\n\n${a.text}` });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_score_contact',
    'Score 0-100 how likely this contact is to convert in the next 30 days, with a one-sentence reason.',
    { contactId: z.string() },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const contactCtx = await loadContactContext(ctx.org.organizationId, a.contactId);
      if (!contactCtx || !contactCtx.contact) return errOut('CONTACT_NOT_FOUND');
      const summary = JSON.stringify({
        contact: { name: [contactCtx.contact.firstName, contactCtx.contact.lastName].filter(Boolean).join(' '), jobTitle: contactCtx.contact.jobTitle, email: contactCtx.contact.email, lifecycle: contactCtx.contact.lifecycle },
        recentActivities: contactCtx.recentActivities.slice(0, 5).map((a: typeof schema.activities.$inferSelect) => ({ type: a.type, title: a.title })),
        openDeals: contactCtx.openDeals.map((d: typeof schema.deals.$inferSelect) => ({ name: d.name, valueMinor: d.valueMinor })),
        recentMessages: contactCtx.recentMessages.slice(0, 10).map((m: typeof schema.messageEvents.$inferSelect) => ({ kind: m.kind })),
      });
      const result = await askForJson({ system: system(), user: `${SCORE_PROMPT}\n\n${summary}` });
      // Persist the score for cheap retrieval later.
      if (result && typeof result === 'object' && 'score' in (result as Record<string, unknown>)) {
        const score = Number((result as { score: unknown }).score);
        if (Number.isFinite(score)) {
          const db = createDb(config.DATABASE_URL);
          await db
            .update(schema.contacts)
            .set({
              customValues: { ...(contactCtx.contact.customValues ?? {}), ai_score: score, ai_score_at: new Date().toISOString() },
            })
            .where(and(eq(schema.contacts.organizationId, ctx.org.organizationId), eq(schema.contacts.id, a.contactId)));
        }
      }
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_summarize_contact',
    'Three-sentence TL;DR of this contact: who they are, last interaction, current state, plus a suggested next step.',
    { contactId: z.string() },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const contactCtx = await loadContactContext(ctx.org.organizationId, a.contactId);
      if (!contactCtx || !contactCtx.contact) return errOut('CONTACT_NOT_FOUND');
      const summary = JSON.stringify({
        contact: { name: [contactCtx.contact.firstName, contactCtx.contact.lastName].filter(Boolean).join(' '), jobTitle: contactCtx.contact.jobTitle, email: contactCtx.contact.email, companyId: contactCtx.contact.companyId },
        recentActivities: contactCtx.recentActivities.slice(0, 8).map((a: typeof schema.activities.$inferSelect) => ({ type: a.type, title: a.title })),
        openDeals: contactCtx.openDeals.map((d: typeof schema.deals.$inferSelect) => ({ name: d.name, valueMinor: d.valueMinor })),
        recentMessages: contactCtx.recentMessages.slice(0, 10).map((m: typeof schema.messageEvents.$inferSelect) => ({ kind: m.kind })),
      });
      const result = await askForJson({ system: system(), user: `${SUMMARIZE_PROMPT}\n\n${summary}`, maxTokens: 600 });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_deal_risks',
    'Scan the open deals and return the 10 most at-risk with a one-line suggested next action each.',
    {},
    async () => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const db = createDb(config.DATABASE_URL);
      const { and, desc, eq } = await import('drizzle-orm');
      const openDeals = await db
        .select()
        .from(schema.deals)
        .where(and(eq(schema.deals.organizationId, ctx.org.organizationId), eq(schema.deals.status, 'open')))
        .orderBy(desc(schema.deals.updatedAt))
        .limit(40);
      if (openDeals.length === 0) return jsonOut({ risks: [] });
      // Activities use subjectType/subjectId, not dealId. We pull the
      // last activity by dealId via the deal's recent updates instead.
      const lastByDeal = new Map<string, string>();
      for (const d of openDeals) {
        lastByDeal.set(d.id, (d.updatedAt as unknown as string) ?? '');
      }
      const now = Date.now();
      const trimmed = openDeals.map((d) => {
        const last = lastByDeal.get(d.id);
        const days = last ? Math.floor((now - new Date(last).getTime()) / 86_400_000) : 999;
        const daysToClose = d.expectedCloseAt ? Math.floor((new Date(d.expectedCloseAt).getTime() - now) / 86_400_000) : null;
        return { dealId: d.id, name: d.name, stage: d.stageId, valueMinor: d.valueMinor, expectedCloseAt: d.expectedCloseAt, daysToClose, daysSinceLastActivity: days };
      });
      const result = await askForJson({ system: system(), user: `${DEAL_RISK_PROMPT}\n\nDEALS:\n${JSON.stringify(trimmed, null, 2)}`, maxTokens: 2000 });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_draft_reply',
    'Draft a reply email to this contact, optionally with a user-supplied context (their angle).',
    {
      contactId: z.string(),
      context: z.string().optional(),
    },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const contactCtx = await loadContactContext(ctx.org.organizationId, a.contactId);
      if (!contactCtx || !contactCtx.contact) return errOut('CONTACT_NOT_FOUND');
      const summary = JSON.stringify({
        contact: { name: [contactCtx.contact.firstName, contactCtx.contact.lastName].filter(Boolean).join(' '), jobTitle: contactCtx.contact.jobTitle, email: contactCtx.contact.email },
        recentMessages: contactCtx.recentMessages.slice(0, 8).map((m: typeof schema.messageEvents.$inferSelect) => ({ kind: m.kind, createdAt: m.createdAt })),
        userContext: a.context ?? null,
      });
      const result = await askForJson({ system: system(), user: `${DRAFT_REPLY_PROMPT}\n\n${summary}`, maxTokens: 1200 });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_build_list',
    'Translate a natural-language list query ("EU leads who opened >2 emails last week") into a JSON filter spec.',
    { query: z.string() },
    async (a) => {
      if (!llmConfigured()) return errOut('LLM_NOT_CONFIGURED');
      const result = await askForJson({ system: system(), user: `${BUILD_LIST_PROMPT}\n\nUSER QUERY: ${a.query}` });
      return jsonOut(result);
    },
  );

  server.tool(
    'ai_status',
    'Whether the LLM is configured and which model is active.',
    {},
    async () => {
      return jsonOut({ configured: llmConfigured(), model: llmConfigured() ? config.LLM_MODEL : null, provider: config.LLM_PROVIDER });
    },
  );
}
