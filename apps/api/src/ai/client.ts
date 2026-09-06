/**
 * Shared helpers for the AI routes and tools.
 *
 * Owns the LlmClient lifecycle (lazy, keyed on env vars), a JSON
 * extraction helper that's robust to LLM drift (sometimes the model
 * wraps its JSON in a code block or adds a comment), and a few
 * helpers to fetch the contact / deal context the prompts need.
 */
import { createLlmClient, type LlmClient, type LlmRequest, LlmError } from '@departify-crm/llm';
import { createDb, schema } from '@departify-crm/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';

let client: LlmClient | null = null;
export function getLlm(): LlmClient | null {
  if (!config.LLM_API_KEY) return null;
  if (client) return client;
  client = createLlmClient({
    provider: config.LLM_PROVIDER,
    apiKey: config.LLM_API_KEY,
    baseUrl: config.LLM_BASE_URL,
    model: config.LLM_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_MAX_RETRIES,
  });
  return client;
}

export function llmConfigured(): boolean {
  return Boolean(config.LLM_API_KEY);
}

/**
 * Run a chat and parse the assistant's reply as JSON. Tolerant of
 * ```json fences, leading prose, and trailing explanations. If the
 * model returns something that doesn't look like JSON we return
 * null and let the caller decide what to do.
 */
export async function askForJson(
  prompt: { system: string; user: string; modelOverride?: string; maxTokens?: number },
): Promise<unknown | null> {
  const c = getLlm();
  if (!c) throw new LlmError('auth_failed', 'LLM_API_KEY not configured');
  const req: LlmRequest = {
    model: prompt.modelOverride ?? config.LLM_MODEL,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    max_tokens: prompt.maxTokens ?? 1024,
    temperature: 0.4,
  };
  const res = await c.chat(req);
  // Pull the text out of the response.
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim();
  return extractJson(text);
}

function extractJson(text: string): unknown | null {
  // Strip ```json fences (and any other fences).
  let s = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  // First quick win: the whole string is JSON.
  try { return JSON.parse(s); } catch { /* keep going */ }
  // Find the first { and the matching close brace. We don't need a
  // full parser — the model is supposed to return a single object.
  const start = s.indexOf('{');
  if (start === -1) return null;
  // Walk forward keeping track of nesting.
  let depth = 0;
  let inStr = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  const candidate = s.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

/** Fetch a small bundle of context for the AI prompts. */

export interface ContactContext {
  contact: typeof schema.contacts.$inferSelect | null;
  recentActivities: Array<typeof schema.activities.$inferSelect>;
  openDeals: Array<typeof schema.deals.$inferSelect>;
  recentMessages: Array<typeof schema.messageEvents.$inferSelect>;
}

export async function loadContactContext(orgId: string, contactId: string): Promise<ContactContext | null> {
  const db = createDb(config.DATABASE_URL);
  const contact = (await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.organizationId, orgId), eq(schema.contacts.id, contactId)))
    .limit(1))[0] ?? null;
  if (!contact) return null;
  const recentActivities = await db
    .select()
    .from(schema.activities)
    .where(and(eq(schema.activities.organizationId, orgId), eq(schema.activities.subjectType, 'contact'), eq(schema.activities.subjectId, contactId)))
    .orderBy(desc(schema.activities.createdAt))
    .limit(20);
  // We don't store dealId on contacts; query via the dealCompanies
  // join + the companyId on the contact. Fall back to listing open
  // deals for the org if no company is set.
  let openDeals: Array<typeof schema.deals.$inferSelect> = [];
  if (contact.companyId) {
    openDeals = await db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, orgId), eq(schema.deals.companyId, contact.companyId), eq(schema.deals.status, 'open')))
      .orderBy(desc(schema.deals.updatedAt))
      .limit(10);
  } else {
    openDeals = await db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, orgId), eq(schema.deals.status, 'open')))
      .orderBy(desc(schema.deals.updatedAt))
      .limit(10);
  }
  const recentMessages = await db
    .select()
    .from(schema.messageEvents)
    .where(and(
      eq(schema.messageEvents.organizationId, orgId),
      eq(schema.messageEvents.contactId, contactId),
      gte(schema.messageEvents.createdAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
    ))
    .orderBy(desc(schema.messageEvents.createdAt))
    .limit(15);
  void gte;
  return { contact, recentActivities, openDeals, recentMessages };
}
