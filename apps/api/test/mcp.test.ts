/**
 * Sprint 6 — MCP server tests.
 *
 * Coverage:
 *  1. Auth: missing/bad bearer → 401.
 *  2. Tools/list: returns a non-empty list of tools.
 *  3. Tools/call: a real list + get + create + update + delete round-trip
 *     for contacts (representative of the rest of the entities).
 *  4. Org scoping: a second org's data is invisible to the first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import argon2 from 'argon2';
import { startTestApi, resetSchema, type TestApi } from './helpers/test-api';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm_test_mcp';

let api: TestApi | null = null;
let BASE_URL = '';

beforeAll(async () => {
  await resetSchema(DATABASE_URL);
  api = await startTestApi(DATABASE_URL);
  BASE_URL = api.baseUrl;
}, 60_000);

afterAll(async () => {
  await api?.stop();
});

async function makeOrgAndApiKey(emailSuffix: string): Promise<{ token: string; orgId: string }> {
  const db = createDb(DATABASE_URL);
  const orgId = generateId(Prefixes.organization);
  const userId = generateId(Prefixes.user);
  const passwordHash = await argon2.hash('password-1234', { type: argon2.argon2id });
  await db.insert(schema.organizations).values({ id: orgId, name: `MCP Org ${emailSuffix}`, slug: `mcp-${emailSuffix}` });
  await db.insert(schema.users).values({ id: userId, email: `mcp-${emailSuffix}@test`, passwordHash, displayName: 'MCP' });
  await db.insert(schema.memberships).values({
    id: generateId(Prefixes.membership),
    organizationId: orgId,
    userId,
    role: 'owner',
    status: 'active',
  });
  const apiKeyId = generateId(Prefixes.apiKey);
  const token = `mcp_test_${apiKeyId}_${Math.random().toString(36).slice(2, 14)}`;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  await db.insert(schema.apiKeys).values({
    id: apiKeyId,
    organizationId: orgId,
    name: 'mcp-test',
    tokenHash: hash,
    prefix: token.slice(0, 12),
    scopes: [],
    status: 'active',
    createdBy: userId,
  });
  return { token, orgId };
}

/**
 * Tiny MCP JSON-RPC client. We avoid pulling in `@modelcontextprotocol/sdk`
 * as a dev dep just to call tools — JSON-RPC over HTTP is straightforward
 * and the tests only need `initialize`, `tools/list`, `tools/call`.
 *
 * The MCP transport requires the standard `initialize` →
 * `notifications/initialized` handshake before any other method is
 * accepted. We handle it here and cache the session id per token.
 */
interface McpClient {
  request: (method: string, params?: Record<string, unknown>) => Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>;
}

async function createMcpClient(token: string | null): Promise<McpClient> {
  const sessionIdRef: { current: string | null } = { current: null };
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) baseHeaders['authorization'] = `Bearer ${token}`;

  // 1) initialize
  const initRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-test-client', version: '0.0.1' },
      },
    }),
  });
  const sid = initRes.headers.get('mcp-session-id');
  if (sid) sessionIdRef.current = sid;

  // 2) notifications/initialized (no id, server should accept it)
  await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { ...baseHeaders, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }),
  });

  return {
    request: async (method, params = {}) => {
      const headers: Record<string, string> = { ...baseHeaders };
      if (sessionIdRef.current) headers['mcp-session-id'] = sessionIdRef.current;
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Math.floor(Math.random() * 1e9),
          method,
          params,
        }),
      });
      // Refresh session id in case the server rotated it.
      const newSid = res.headers.get('mcp-session-id');
      if (newSid) sessionIdRef.current = newSid;
      const text = await res.text();
      if (!text) return { error: { code: -1, message: 'empty response' } };
      try {
        return JSON.parse(text) as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      } catch {
        return { error: { code: -1, message: `non-JSON response: ${text.slice(0, 200)}` } };
      }
    },
  };
}

describe('MCP server: auth', () => {
  it('rejects bad bearer tokens with 401 on initialize', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer not-a-real-key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('MCP server: tools', () => {
  let orgA: { token: string; orgId: string };
  let clientA: McpClient;

  beforeAll(async () => {
    orgA = await makeOrgAndApiKey('A');
    clientA = await createMcpClient(orgA.token);
  });

  it('lists tools and includes the core entity tools', async () => {
    const r = await clientA.request('tools/list');
    expect(r.result).toBeTruthy();
    const list = (r.result as { tools: Array<{ name: string }> }).tools;
    const names = list.map((t) => t.name);
    for (const expected of [
      'list_contacts',
      'get_contact',
      'create_contact',
      'update_contact',
      'delete_contact',
      'list_sequences',
      'create_sequence',
      'enroll_contact_in_sequence',
      'add_suppression',
      'list_message_events',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('round-trips a contact through create → get → update → list → delete', async () => {
    // create
    const created = await clientA.request('tools/call', {
      name: 'create_contact',
      arguments: { fullName: 'MCP Test', email: 'mcp-test@example.test' },
    });
    expect(created.error).toBeUndefined();
    const newId = JSON.parse((created.result as { content: Array<{ text: string }> }).content[0]!.text).id as string;
    expect(newId).toMatch(/^con_/);

    // get
    const got = await clientA.request('tools/call', {
      name: 'get_contact', arguments: { id: newId },
    });
    const gotRow = JSON.parse((got.result as { content: Array<{ text: string }> }).content[0]!.text);
    expect(gotRow.fullName).toBe('MCP Test');
    expect(gotRow.email).toBe('mcp-test@example.test');

    // update
    const upd = await clientA.request('tools/call', {
      name: 'update_contact', arguments: { id: newId, patch: { jobTitle: 'CEO' } },
    });
    expect(JSON.parse((upd.result as { content: Array<{ text: string }> }).content[0]!.text)).toMatchObject({ ok: true });

    // list should include it with the updated jobTitle
    const list = await clientA.request('tools/call', {
      name: 'list_contacts', arguments: { search: 'mcp-test', pageSize: 10 },
    });
    const listBody = JSON.parse((list.result as { content: Array<{ text: string }> }).content[0]!.text);
    const found = listBody.items.find((c: { id: string }) => c.id === newId);
    expect(found).toBeTruthy();
    expect(found.jobTitle).toBe('CEO');

    // delete
    const del = await clientA.request('tools/call', {
      name: 'delete_contact', arguments: { id: newId },
    });
    expect(JSON.parse((del.result as { content: Array<{ text: string }> }).content[0]!.text)).toMatchObject({ ok: true });
  });

  it('returns NOT_FOUND when get_contact sees a missing id', async () => {
    const r = await clientA.request('tools/call', {
      name: 'get_contact', arguments: { id: 'con_does_not_exist' },
    });
    expect(r.error).toBeUndefined();
    const result = r.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/NOT_FOUND/);
  });
});

describe('MCP server: org scoping', () => {
  it('org A cannot see org B contacts', async () => {
    const A = await makeOrgAndApiKey('scope-A');
    const B = await makeOrgAndApiKey('scope-B');
    const clientB = await createMcpClient(B.token);
    const clientA = await createMcpClient(A.token);

    // Create a contact in B
    const created = await clientB.request('tools/call', {
      name: 'create_contact', arguments: { fullName: 'B Private', email: 'b-private@example.test' },
    });
    expect(created.error).toBeUndefined();
    const bId = JSON.parse((created.result as { content: Array<{ text: string }> }).content[0]!.text).id;

    // A tries to get it
    const got = await clientA.request('tools/call', {
      name: 'get_contact', arguments: { id: bId },
    });
    const gotResult = got.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(gotResult.isError).toBe(true);
    expect(gotResult.content[0]!.text).toMatch(/NOT_FOUND/);

    // A's list_contacts should not include it
    const list = await clientA.request('tools/call', {
      name: 'list_contacts', arguments: { search: 'b-private' },
    });
    const listBody = JSON.parse((list.result as { content: Array<{ text: string }> }).content[0]!.text);
    expect(listBody.items.length).toBe(0);
  });
});
