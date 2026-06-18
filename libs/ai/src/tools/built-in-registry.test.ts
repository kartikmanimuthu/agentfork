import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  jsonSchema: (schema: unknown) => schema,
  tool: (def: unknown) => def,
}));

// web-fetch pulls in playwright at import time; stub it so the suite stays hermetic.
vi.mock('./web-fetch', () => ({
  buildWebFetchTool: () => ({ web_fetch: { description: 'fetch', execute: vi.fn() } }),
}));

// Control which env vars the registry sees.
const mockEnv: Record<string, string | undefined> = {};
vi.mock('../env', () => ({
  get env() {
    return mockEnv;
  },
}));

import { buildBuiltInTools } from './built-in-registry';

describe('buildBuiltInTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.TAVILY_API_KEY = undefined;
    mockEnv.BRAVE_API_KEY = undefined;
    mockEnv.SEARXNG_API_BASE = undefined;
  });

  it('always includes web_fetch, even with no search provider configured', async () => {
    const tools = await buildBuiltInTools('tenant-1');
    expect(tools.web_fetch).toBeDefined();
    expect(tools.web_search).toBeUndefined();
  });

  it('adds web_search from the env fallback (Tavily)', async () => {
    mockEnv.TAVILY_API_KEY = 'tvly-x';
    const tools = await buildBuiltInTools('tenant-1');
    expect(tools.web_search).toBeDefined();
    expect(tools.web_fetch).toBeDefined();
  });

  it('prefers the tenant config resolver over env vars', async () => {
    mockEnv.TAVILY_API_KEY = 'tvly-env';
    const get = vi.fn().mockResolvedValue({ provider: 'brave', apiKey: 'brave-tenant' });

    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });

    expect(get).toHaveBeenCalledWith('webSearchConfig');
    expect(tools.web_search).toBeDefined();
  });

  it('falls back to env when the resolver returns null', async () => {
    mockEnv.BRAVE_API_KEY = 'brave-env';
    const get = vi.fn().mockResolvedValue(null);

    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });

    expect(tools.web_search).toBeDefined();
  });

  it('does not throw when the resolver rejects — degrades to env/none', async () => {
    const get = vi.fn().mockRejectedValue(new Error('config service down'));
    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });
    // No env provider set, resolver failed → only web_fetch survives.
    expect(tools.web_fetch).toBeDefined();
    expect(tools.web_search).toBeUndefined();
  });
});
