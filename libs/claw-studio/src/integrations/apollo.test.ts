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

import { apolloDescriptor, createApolloTools } from './apollo';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('apolloDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives the account id + label from the user-chosen label (Apollo has no identity of its own)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ is_logged_in: true }));
    const result = await apolloDescriptor.verify({ apiKey: 'apollo-key', label: 'Work Apollo' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('apollo-work-apollo');
      expect(result.meta?.label).toBe('Work Apollo');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apollo.io/api/v1/auth/health',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'apollo-key' }) }),
    );
  });

  it('falls back to "default" when no label is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ is_logged_in: true }));
    const result = await apolloDescriptor.verify({ apiKey: 'apollo-key' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('apollo-default');
      expect(result.meta?.label).toBe('default');
    }
  });

  it('fails when no api key is given', async () => {
    const result = await apolloDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the health check rejects the key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, false, 401));
    const result = await apolloDescriptor.verify({ apiKey: 'bad-key' });
    expect(result.ok).toBe(false);
  });
});

describe('createApolloTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected read-only tool set', () => {
    const names = createApolloTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['apollo_enrich_person', 'apollo_enrich_company', 'apollo_search_people']);
  });

  it('resolves the default account when one is connected', async () => {
    store.set('claw-integration-apollo:account:apollo-work', { data: { apiKey: 'enc(a)', label: 'work' } });
    store.set('claw-integration-apollo:default', { data: { accountId: 'apollo-work' } });
    fetchMock.mockResolvedValue(jsonResponse({ person: { name: 'Jane' } }));

    const [enrichPerson] = createApolloTools('tenant-1');
    await enrichPerson.invoke({ email: 'jane@example.com' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apollo.io/api/v1/people/match',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'a' }) }),
    );
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-apollo:account:apollo-work', { data: { apiKey: 'enc(a)', label: 'work' } });
    store.set('claw-integration-apollo:account:apollo-personal', { data: { apiKey: 'enc(b)', label: 'personal' } });
    store.set('claw-integration-apollo:default', { data: { accountId: 'apollo-work' } });
    fetchMock.mockResolvedValue(jsonResponse({ person: {} }));

    const [enrichPerson] = createApolloTools('tenant-1');
    await enrichPerson.invoke({ email: 'jane@example.com', account: 'apollo-personal' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'b' }) }),
    );
  });

  it('a second connect() creates a second account row addressable by its own label', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ is_logged_in: true }));
    const first = await apolloDescriptor.verify({ apiKey: 'key-a', label: 'work' });
    const second = await apolloDescriptor.verify({ apiKey: 'key-b', label: 'personal' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.meta?.accountId).not.toBe(second.meta?.accountId);
    }
  });

  it('enrich_person requires an email or a name before calling the API', async () => {
    store.set('claw-integration-apollo:account:apollo-work', { data: { apiKey: 'enc(a)', label: 'work' } });
    store.set('claw-integration-apollo:default', { data: { accountId: 'apollo-work' } });

    const [enrichPerson] = createApolloTools('tenant-1');
    const result = await enrichPerson.invoke({} as never);

    expect(result).toContain('email');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports not-connected when no account exists', async () => {
    const [enrichPerson] = createApolloTools('tenant-1');
    const result = await enrichPerson.invoke({ email: 'jane@example.com' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-apollo:account:apollo-work', { data: { apiKey: 'enc(a)', label: 'work' } });
    store.set('claw-integration-apollo:default', { data: { accountId: 'apollo-work' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, false, 401));

    const [enrichPerson] = createApolloTools('tenant-1');
    const result = await enrichPerson.invoke({ email: 'jane@example.com' } as never);
    expect(result).toContain('Error enriching Apollo person');
    expect(result).toContain('401');
  });
});
