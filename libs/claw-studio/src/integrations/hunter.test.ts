import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { data: Record<string, unknown> }>();
const mockGet = vi.fn(async (key: string) => store.get(key)?.data ?? null);
const mockSet = vi.fn(async (key: string, value: Record<string, unknown>) => {
  store.set(key, { data: value });
});
const mockDelete = vi.fn(async (key: string) => store.delete(key));
const mockListByPrefix = vi.fn(async (prefix: string) =>
  Array.from(store.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([configKey, row]) => ({ configKey, data: row.data, updatedAt: new Date(), updatedBy: 'system' })),
);

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    listByPrefix: mockListByPrefix,
  })),
  EncryptionService: vi.fn().mockImplementation(() => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
  })),
}));

import { hunterDescriptor, createHunterTools } from './hunter';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('hunterDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives a stable account id + label from the account email', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { email: 'me@acme.com' } }));
    const result = await hunterDescriptor.verify({ apiKey: 'hunter-key' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('hunter-me-acme-com');
      expect(result.meta?.label).toBe('me@acme.com');
    }
    // Hunter's own convention: the key goes in the query string, not a header.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api_key=hunter-key'),
      expect.any(Object),
    );
  });

  it('fails when no api key is given', async () => {
    const result = await hunterDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no account email comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    const result = await hunterDescriptor.verify({ apiKey: 'hunter-key' });
    expect(result.ok).toBe(false);
  });
});

describe('createHunterTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected read-only tool set', () => {
    const names = createHunterTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['hunter_domain_search', 'hunter_find_email', 'hunter_verify_email']);
  });

  it('resolves the default account and appends api_key to the query string', async () => {
    store.set('claw-integration-hunter:account:hunter-me-acme-com', { data: { apiKey: 'enc(a)', label: 'me@acme.com' } });
    store.set('claw-integration-hunter:default', { data: { accountId: 'hunter-me-acme-com' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { emails: [] } }));

    const [domainSearch] = createHunterTools('tenant-1');
    await domainSearch.invoke({ domain: 'acme.com' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/api\.hunter\.io\/v2\/domain-search\?.*api_key=a/),
      expect.any(Object),
    );
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-hunter:account:hunter-a', { data: { apiKey: 'enc(a)', label: 'a@acme.com' } });
    store.set('claw-integration-hunter:account:hunter-b', { data: { apiKey: 'enc(b)', label: 'b@acme.com' } });
    store.set('claw-integration-hunter:default', { data: { accountId: 'hunter-a' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { emails: [] } }));

    const [domainSearch] = createHunterTools('tenant-1');
    await domainSearch.invoke({ domain: 'acme.com', account: 'hunter-b' } as never);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api_key=b'), expect.any(Object));
  });

  it('a second connect() creates a second account row addressable by its own email-derived id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { email: 'a@acme.com' } }));
    const first = await hunterDescriptor.verify({ apiKey: 'key-a' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { email: 'b@acme.com' } }));
    const second = await hunterDescriptor.verify({ apiKey: 'key-b' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.meta?.accountId).not.toBe(second.meta?.accountId);
    }
  });

  it('reports not-connected when no account exists', async () => {
    const [domainSearch] = createHunterTools('tenant-1');
    const result = await domainSearch.invoke({ domain: 'acme.com' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-hunter:account:hunter-me-acme-com', { data: { apiKey: 'enc(a)', label: 'me@acme.com' } });
    store.set('claw-integration-hunter:default', { data: { accountId: 'hunter-me-acme-com' } });
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ details: 'Invalid API key' }] }, false, 401));

    const [domainSearch] = createHunterTools('tenant-1');
    const result = await domainSearch.invoke({ domain: 'acme.com' } as never);
    expect(result).toContain('Error searching Hunter domain');
    expect(result).toContain('401');
  });
});
