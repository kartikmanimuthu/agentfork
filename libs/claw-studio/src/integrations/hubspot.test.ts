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

import { hubspotDescriptor, createHubspotTools } from './hubspot';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('hubspotDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives a stable account id + label from the portal id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ portalId: 12345678 }));
    const result = await hubspotDescriptor.verify({ token: 'pat-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('hub-12345678');
      expect(result.meta?.label).toBe('Portal 12345678');
    }
  });

  it('fails when no portalId comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await hubspotDescriptor.verify({ token: 'pat-test' });
    expect(result.ok).toBe(false);
  });
});

describe('createHubspotTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('gates write tools with names tool-classifier.ts already recognizes', () => {
    const names = createHubspotTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['hubspot_search_contacts', 'hubspot_get_contact', 'hubspot_create_note', 'hubspot_update_contact']);
  });

  it('resolves the default portal when multiple are connected and none is named', async () => {
    store.set('claw-integration-hubspot:account:hub-1', { data: { token: 'enc(a)', label: 'Portal 1' } });
    store.set('claw-integration-hubspot:account:hub-2', { data: { token: 'enc(b)', label: 'Portal 2' } });
    store.set('claw-integration-hubspot:default', { data: { accountId: 'hub-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    const [searchContacts] = createHubspotTools('tenant-1');
    await searchContacts.invoke({ query: 'acme' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/contacts/search',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer a' }) }),
    );
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-hubspot:account:hub-1', { data: { token: 'enc(a)', label: 'Portal 1' } });
    store.set('claw-integration-hubspot:account:hub-2', { data: { token: 'enc(b)', label: 'Portal 2' } });
    store.set('claw-integration-hubspot:default', { data: { accountId: 'hub-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    const [searchContacts] = createHubspotTools('tenant-1');
    await searchContacts.invoke({ query: 'acme', account: 'hub-2' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer b' }) }),
    );
  });

  it('reports not-connected when no portal exists', async () => {
    const [searchContacts] = createHubspotTools('tenant-1');
    const result = await searchContacts.invoke({ query: 'acme' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
