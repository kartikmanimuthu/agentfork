/**
 * persistence.test.ts
 *
 * Live integration test against the local Postgres (docker-compose chatbot-postgres,
 * schema already pushed via `bunx prisma db push`). Exercises the real
 * PostgresSaver.fromConnString(...).setup() — no mocking of the checkpointer or
 * the DB. Embeddings are never touched here (getMemoryStore()'s Bedrock-resolving
 * path only runs lazily inside batch(), which these tests never call), so this
 * stays offline for Bedrock while being a real Postgres round trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TEST_DATABASE_URL = 'postgresql://chatbot_admin:chatbot_dev@localhost:5433/chatbot?schema=public';

function clearPersistenceSingleton() {
    const g = globalThis as Record<string, unknown>;
    delete g._persistence;
    delete g._persistencePromise;
}

describe('persistence (live Postgres)', () => {
    beforeEach(() => {
        vi.resetModules();
        clearPersistenceSingleton();
        vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    });

    afterEach(() => {
        clearPersistenceSingleton();
        vi.unstubAllEnvs();
    });

    it('getCheckpointer() resolves a real PostgresSaver and setup() succeeds against local Postgres', async () => {
        const { getCheckpointer } = await import('./persistence');
        const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');

        const checkpointer = await getCheckpointer();

        expect(checkpointer).toBeInstanceOf(PostgresSaver);
        // setup() already ran inside getCheckpointer() (via initPersistence). A checkpoint
        // put+list round trip proves setup() actually created usable tables, not just
        // that the call didn't throw. Shape matches the package README's example verbatim.
        const threadId = `persistence-test-${Date.now()}`;
        const writeConfig = { configurable: { thread_id: threadId, checkpoint_ns: '' } };
        const readConfig = { configurable: { thread_id: threadId } };
        const checkpoint = {
            v: 1,
            ts: new Date().toISOString(),
            id: '1ef4f797-8335-6428-8001-8a1503f9b875',
            channel_values: { my_key: 'meow', node: 'node' },
            channel_versions: { __start__: 2, my_key: 3, 'start:node': 3, node: 3 },
            versions_seen: { __input__: {}, __start__: { __start__: 1 }, node: { 'start:node': 2 } },
            pending_sends: [],
        };
        await checkpointer.put(writeConfig, checkpoint as any, {} as any, {});

        const list: unknown[] = [];
        for await (const item of checkpointer.list(readConfig)) list.push(item);
        expect(list.length).toBeGreaterThan(0);
    }, 20000);

    it('getMemoryStore() resolves a PostgresMemoryStore exposing batch()', async () => {
        const { getMemoryStore } = await import('./persistence');
        const store = await getMemoryStore();
        expect(typeof (store as { batch: unknown }).batch).toBe('function');
    }, 20000);

    it('getCheckpointer() and getMemoryStore() share one singleton across calls', async () => {
        const { getCheckpointer, getMemoryStore } = await import('./persistence');
        const c1 = await getCheckpointer();
        const c2 = await getCheckpointer();
        const s1 = await getMemoryStore();
        const s2 = await getMemoryStore();
        expect(c1).toBe(c2);
        expect(s1).toBe(s2);
    }, 20000);
});
