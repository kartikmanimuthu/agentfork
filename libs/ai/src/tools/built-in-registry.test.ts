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

import { buildBuiltInTools, resolveSearchConfig, resolveWebFetchEnabled } from './built-in-registry';

describe('buildBuiltInTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.TAVILY_API_KEY = undefined;
    mockEnv.BRAVE_API_KEY = undefined;
    mockEnv.SEARXNG_API_BASE = undefined;
    mockEnv.WEB_FETCH_ENABLED = undefined;
  });

  it('includes neither tool when nothing is configured', async () => {
    const tools = await buildBuiltInTools('tenant-1');
    expect(tools.web_fetch).toBeUndefined();
    expect(tools.web_search).toBeUndefined();
  });

  it('adds web_search from the env fallback (Tavily), web_fetch stays off', async () => {
    mockEnv.TAVILY_API_KEY = 'tvly-x';
    const tools = await buildBuiltInTools('tenant-1');
    expect(tools.web_search).toBeDefined();
    expect(tools.web_fetch).toBeUndefined();
  });

  it('adds web_fetch from the env fallback', async () => {
    mockEnv.WEB_FETCH_ENABLED = 'true';
    const tools = await buildBuiltInTools('tenant-1');
    expect(tools.web_fetch).toBeDefined();
    expect(tools.web_search).toBeUndefined();
  });

  it('prefers the tenant config resolver over env vars', async () => {
    mockEnv.TAVILY_API_KEY = 'tvly-env';
    const get = vi.fn((key: string) =>
      key === 'webSearchConfig' ? { provider: 'brave', apiKey: 'brave-tenant' } : null
    );

    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });

    expect(get).toHaveBeenCalledWith('webSearchConfig');
    expect(get).toHaveBeenCalledWith('webFetchEnabled');
    expect(tools.web_search).toBeDefined();
    expect(tools.web_fetch).toBeUndefined();
  });

  it('enables web_fetch via the tenant config resolver', async () => {
    const get = vi.fn((key: string) => (key === 'webFetchEnabled' ? true : null));

    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });

    expect(tools.web_fetch).toBeDefined();
  });

  it('tenant config resolver explicitly disabling web_fetch overrides an enabled env var', async () => {
    mockEnv.WEB_FETCH_ENABLED = 'true';
    const get = vi.fn((key: string) => (key === 'webFetchEnabled' ? false : null));

    const tools = await buildBuiltInTools('tenant-1', { configResolver: { get } });

    expect(tools.web_fetch).toBeUndefined();
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
    // No env provider set, resolver failed → neither tool survives.
    expect(tools.web_fetch).toBeUndefined();
    expect(tools.web_search).toBeUndefined();
  });
});

describe('resolveWebFetchEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.WEB_FETCH_ENABLED = undefined;
  });

  it('defaults to disabled with no resolver and no env var', async () => {
    expect(await resolveWebFetchEnabled('t1')).toBe(false);
  });

  it('reads true from the env fallback', async () => {
    mockEnv.WEB_FETCH_ENABLED = 'true';
    expect(await resolveWebFetchEnabled('t1')).toBe(true);
  });

  it('prefers an explicit tenant config value over the env var', async () => {
    mockEnv.WEB_FETCH_ENABLED = 'true';
    const configResolver = { get: async () => false };
    expect(await resolveWebFetchEnabled('t1', { configResolver })).toBe(false);
  });

  it('falls back to env when the resolver returns null', async () => {
    mockEnv.WEB_FETCH_ENABLED = 'true';
    const configResolver = { get: async () => null };
    expect(await resolveWebFetchEnabled('t1', { configResolver })).toBe(true);
  });

  it('survives a throwing config resolver', async () => {
    const configResolver = {
      get: async () => {
        throw new Error('db down');
      },
    };
    await expect(resolveWebFetchEnabled('t1', { configResolver })).resolves.toBe(false);
  });
});

describe('resolveSearchConfig', () => {
  it('prefers tenant config over env', async () => {
    const configResolver = { get: async () => ({ provider: 'brave', apiKey: 'tenant-key' }) };

    const config = await resolveSearchConfig('t1', { configResolver });

    expect(config).toEqual({ provider: 'brave', apiKey: 'tenant-key' });
  });

  it('returns null when neither tenant config nor env supplies a provider', async () => {
    const configResolver = { get: async () => null };

    const config = await resolveSearchConfig('t1', { configResolver });

    expect(config).toBeNull();
  });

  it('ignores a tenant config with no provider field', async () => {
    const configResolver = { get: async () => ({ apiKey: 'orphan' }) as never };

    expect(await resolveSearchConfig('t1', { configResolver })).toBeNull();
  });

  it('survives a throwing config resolver', async () => {
    const configResolver = {
      get: async () => {
        throw new Error('db down');
      },
    };

    await expect(resolveSearchConfig('t1', { configResolver })).resolves.toBeNull();
  });
});
