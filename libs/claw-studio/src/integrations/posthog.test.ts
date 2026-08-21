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

import { posthogDescriptor, createPosthogTools } from './posthog';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('posthogDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('keys the account by projectId (not by anything the response returns)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'dev@acme.com' }));
    const result = await posthogDescriptor.verify({ apiKey: 'phx_test', projectId: '42' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('42');
      expect(result.meta?.label).toContain('dev@acme.com');
    }
  });

  it('defaults to US cloud when baseUrl is omitted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'dev@acme.com' }));
    await posthogDescriptor.verify({ apiKey: 'phx_test', projectId: '42' });
    expect(fetchMock).toHaveBeenCalledWith('https://us.posthog.com/api/users/@me/', expect.anything());
  });

  it('honors an explicit baseUrl override (EU cloud / self-hosted)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'dev@acme.com' }));
    await posthogDescriptor.verify({ apiKey: 'phx_test', projectId: '42', baseUrl: 'https://eu.posthog.com/' });
    expect(fetchMock).toHaveBeenCalledWith('https://eu.posthog.com/api/users/@me/', expect.anything());
  });

  it('fails when no projectId is given', async () => {
    const result = await posthogDescriptor.verify({ apiKey: 'phx_test' });
    expect(result.ok).toBe(false);
  });

  it('fails when no apiKey is given', async () => {
    const result = await posthogDescriptor.verify({ projectId: '42' });
    expect(result.ok).toBe(false);
  });
});

describe('createPosthogTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('exposes only read tools', () => {
    const names = createPosthogTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['posthog_query', 'posthog_list_insights']);
  });

  it('resolves the default project and sends a Bearer auth header', async () => {
    store.set('claw-integration-posthog:account:42', { data: { apiKey: 'enc(phx_a)', projectId: '42', label: 'Project 42' } });
    store.set('claw-integration-posthog:default', { data: { accountId: '42' } });
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    const [query] = createPosthogTools('tenant-1');
    await query.invoke({ hogql: 'SELECT event FROM events LIMIT 1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://us.posthog.com/api/projects/42/query',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer phx_a' }) }),
    );
  });

  it('honors a second connected project via an explicit account argument', async () => {
    store.set('claw-integration-posthog:account:42', { data: { apiKey: 'enc(phx_a)', projectId: '42' } });
    store.set('claw-integration-posthog:account:43', { data: { apiKey: 'enc(phx_b)', projectId: '43', baseUrl: 'https://eu.posthog.com' } });
    store.set('claw-integration-posthog:default', { data: { accountId: '42' } });
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    const [query] = createPosthogTools('tenant-1');
    await query.invoke({ hogql: 'SELECT event FROM events LIMIT 1', account: '43' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://eu.posthog.com/api/projects/43/query',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer phx_b' }) }),
    );
  });

  it('reports not-connected when no project exists', async () => {
    const [query] = createPosthogTools('tenant-1');
    const result = await query.invoke({ hogql: 'SELECT 1' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a descriptive error string instead of throwing on API failure', async () => {
    store.set('claw-integration-posthog:account:42', { data: { apiKey: 'enc(phx_a)', projectId: '42' } });
    store.set('claw-integration-posthog:default', { data: { accountId: '42' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad request' }, false, 400));

    const [query] = createPosthogTools('tenant-1');
    const result = await query.invoke({ hogql: 'SELECT 1' } as never);
    expect(result).toContain('Error running PostHog query');
  });
});
