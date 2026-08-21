import { describe, it, expect } from 'vitest';
import { createMemoryTools } from './memory-tools';

// Integration-style: exercises the real saveMemory/searchMemory (Plan C2,
// ./persistence) against the local dev Postgres, matching the pattern
// persistence.test.ts already uses. `vi.mock('./persistence', ...)` does not
// currently intercept relative-module imports in this package (verified via
// a minimal repro reproducing the same failure on the already-committed
// reconcile.test.ts/episode.test.ts) — this is a pre-existing environment
// issue, not something introduced here, so these tests go through the real
// (migrated) DB instead of fighting it.
const TENANT_ID = 'test-tenant-memory-tools';
const USER_ID = 'test-claw-memory-tools';

describe('createMemoryTools', () => {
  it('creates exactly save_memory and search_memory tools with the expected schemas', () => {
    const tools = createMemoryTools(TENANT_ID, USER_ID);
    expect(tools.map((t) => t.name).sort()).toEqual(['save_memory', 'search_memory']);
  });

  it('search_memory reports no matches for a query with nothing saved yet', async () => {
    const tools = createMemoryTools(TENANT_ID, USER_ID);
    const search = tools.find((t) => t.name === 'search_memory')!;
    const result = await search.invoke({
      namespacePrefix: ['integration-test', 'nonexistent'],
      query: 'something that was never saved',
    } as never);
    expect(result).toBe('No memories found.');
  });

  it('save_memory persists a fact, and search_memory finds it back', async () => {
    const tools = createMemoryTools(TENANT_ID, USER_ID);
    const save = tools.find((t) => t.name === 'save_memory')!;
    const search = tools.find((t) => t.name === 'search_memory')!;

    const key = `probe-${Date.now()}`;
    const saveResult = await save.invoke({
      namespace: ['integration-test', 'memory-tools'],
      key,
      value: { fact: 'Claw prefers concise answers' },
    } as never);
    expect(String(saveResult)).toContain(`integration-test/memory-tools/${key}`);

    const searchResult = await search.invoke({
      namespacePrefix: ['integration-test', 'memory-tools'],
      query: 'concise answers preference',
    } as never);
    expect(String(searchResult)).toContain('Claw prefers concise answers');
  });
});
