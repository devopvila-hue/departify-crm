/**
 * Smoke + CRUD tests for Contacts and Deals. These run against a real
 * Postgres + the running test server (see tenant-isolation.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import argon2 from 'argon2';
const BASE_URL = process.env.TEST_API_URL ?? 'http://127.0.0.1:4101';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm_test_2';
let serverHandle = null;
async function waitForServer() {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(`${BASE_URL}/health`);
            if (res.ok)
                return;
        }
        catch {
            /* retry */
        }
        await wait(250);
    }
    throw new Error('test API did not come up');
}
beforeAll(async () => {
    if (process.env.SKIP_SERVER === '1')
        return;
    const db = createDb(DATABASE_URL);
    await db.execute(sql `drop schema public cascade; create schema public;`);
    serverHandle = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
            ...process.env,
            DATABASE_URL,
            PORT: '4101',
            HOST: '127.0.0.1',
            NODE_ENV: 'test',
            SESSION_SECRET: 'a'.repeat(32),
            ENCRYPTION_KEY: 'b'.repeat(32),
            LOG_LEVEL: 'warn',
            RATE_LIMIT_DEFAULT_MAX: '10000',
        },
        stdio: 'pipe',
    });
    serverHandle.stderr?.on('data', (b) => process.stderr.write(`[api] ${b}`));
    await waitForServer();
}, 60_000);
afterAll(async () => {
    if (serverHandle) {
        serverHandle.kill('SIGTERM');
        await wait(500);
    }
});
async function signupAndLogin(email, password, org) {
    const db = createDb(DATABASE_URL);
    const orgId = generateId(Prefixes.organization);
    const userId = generateId(Prefixes.user);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.insert(schema.organizations).values({ id: orgId, name: org, slug: `slug-${Math.random().toString(36).slice(2, 8)}` });
    await db.insert(schema.users).values({ id: userId, email, passwordHash, displayName: 'Test' });
    await db.insert(schema.memberships).values({
        id: generateId(Prefixes.membership),
        organizationId: orgId,
        userId,
        role: 'owner',
        status: 'active',
    });
    const login = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!login.ok)
        throw new Error(`login failed: ${login.status} ${await login.text()}`);
    return login.headers.get('set-cookie').split(';')[0];
}
function authed(cookie) {
    return { cookie };
}
describe('contacts CRUD', () => {
    let cookie;
    it('signs in', async () => {
        cookie = await signupAndLogin('owner@contacts.test', 'password-1234', 'Contacts Org');
    });
    it('creates a contact with the minimum required fields', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/contacts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authed(cookie) },
            body: JSON.stringify({ fullName: 'Lucía Vidal' }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json());
        expect(body.id).toMatch(/^con_/);
    });
    it('rejects contact without fullName', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/contacts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authed(cookie) },
            body: JSON.stringify({ email: 'broken@example.test' }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json());
        expect(body.code).toBe('VALIDATION_ERROR');
    });
    it('lists contacts with pagination + search', async () => {
        // Create 3 more contacts
        for (const name of ['Mateo Castro', 'Sofía Sanz', 'Lucía Martínez']) {
            await fetch(`${BASE_URL}/api/v1/contacts`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...authed(cookie) },
                body: JSON.stringify({ fullName: name }),
            });
        }
        const res = await fetch(`${BASE_URL}/api/v1/contacts?pageSize=10&search=Lucía`, { headers: authed(cookie) });
        expect(res.ok).toBe(true);
        const body = (await res.json());
        expect(body.items.length).toBeGreaterThanOrEqual(2);
        expect(body.items.every((c) => c.fullName.includes('Lucía'))).toBe(true);
    });
});
describe('deals + kanban', () => {
    let cookie;
    let pipelineId;
    let stageId;
    let dealId;
    it('signs in and creates a pipeline + stage', async () => {
        cookie = await signupAndLogin('owner@deals.test', 'password-1234', 'Deals Org');
        // create pipeline via DB shortcut (no admin route required when using the same connection)
        const db = createDb(DATABASE_URL);
        const orgId = (await db.execute(sql `select organization_id from memberships m join users u on u.id = m.user_id where u.email = 'owner@deals.test' limit 1`))[0];
        const org = orgId[0].organization_id;
        pipelineId = generateId(Prefixes.pipeline);
        stageId = generateId(Prefixes.stage);
        await db.insert(schema.pipelines).values({ id: pipelineId, organizationId: org, name: 'Pipeline' });
        await db.insert(schema.stages).values({
            id: stageId,
            organizationId: org,
            pipelineId,
            name: 'Open',
            position: 0,
            defaultProbability: 25,
        });
    });
    it('creates a deal and moves it through a stage', async () => {
        const create = await fetch(`${BASE_URL}/api/v1/deals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authed(cookie) },
            body: JSON.stringify({ pipelineId, stageId, name: 'Acme', value: 12500 }),
        });
        expect(create.status).toBe(201);
        dealId = (await create.json()).id;
        const move = await fetch(`${BASE_URL}/api/v1/deals/${dealId}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authed(cookie) },
            body: JSON.stringify({ stageId }),
        });
        expect(move.ok).toBe(true);
        const got = await fetch(`${BASE_URL}/api/v1/deals/${dealId}`, { headers: authed(cookie) });
        const body = (await got.json());
        expect(body.status).toBe('open');
        expect(body.probability).toBe(25);
    });
    it('returns the kanban for the pipeline', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/pipelines/${pipelineId}/kanban`, { headers: authed(cookie) });
        expect(res.ok).toBe(true);
        const body = (await res.json());
        expect(body.stages.length).toBeGreaterThan(0);
        expect(body.deals.map((d) => d.id)).toContain(dealId);
    });
});
//# sourceMappingURL=contacts.test.js.map