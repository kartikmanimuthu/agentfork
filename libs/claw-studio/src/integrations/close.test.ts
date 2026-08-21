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

import { closeDescriptor, createCloseTools } from './close';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('closeDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('reports the account email on success and uses HTTP Basic auth (key as username, blank password)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'me@acme.com' }));
    const result = await closeDescriptor.verify({ apiKey: 'close-key' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta?.email).toBe('me@acme.com');

    const expectedAuth = `Basic ${Buffer.from('close-key:').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/me/',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
    );
  });

  it('fails when no api key is given', async () => {
    const result = await closeDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no email comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await closeDescriptor.verify({ apiKey: 'close-key' });
    expect(result.ok).toBe(false);
  });
});

describe('createCloseTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('gates write tools with names tool-classifier.ts already recognizes', () => {
    const names = createCloseTools('tenant-1').map((t) => t.name);
    expect(names).toEqual([
      'close_search_leads',
      'close_get_lead',
      'close_list_opportunities',
      'close_create_lead',
      'close_update_opportunity',
      'close_log_note',
    ]);
  });

  it('search_leads calls the Close API with Basic auth once connected', async () => {
    store.set('claw-integration-close:account:default', { data: { apiKey: 'enc(close-key)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [searchLeads] = createCloseTools('tenant-1');
    await searchLeads.invoke({ query: 'status:potential acme' } as never);

    const expectedAuth = `Basic ${Buffer.from('close-key:').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.close.com/api/v1/lead/?'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
    );
  });

  it('create_lead requires approval (write) and posts to /lead/', async () => {
    store.set('claw-integration-close:account:default', { data: { apiKey: 'enc(close-key)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'lead_123' }));

    const [, , , createLead] = createCloseTools('tenant-1');
    const result = await createLead.invoke({ name: 'Acme Inc' } as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.close.com/api/v1/lead/', expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('lead_123');
  });

  it('update_opportunity refuses to call the API with nothing to update', async () => {
    store.set('claw-integration-close:account:default', { data: { apiKey: 'enc(close-key)' } });

    const [, , , , updateOpportunity] = createCloseTools('tenant-1');
    const result = await updateOpportunity.invoke({ opportunityId: 'oppo_1' } as never);

    expect(result).toContain('Nothing to update');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('log_note posts to /activity/note/', async () => {
    store.set('claw-integration-close:account:default', { data: { apiKey: 'enc(close-key)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'acti_1' }));

    const [, , , , , logNote] = createCloseTools('tenant-1');
    const result = await logNote.invoke({ leadId: 'lead_1', note: 'Great call' } as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.close.com/api/v1/activity/note/', expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('acti_1');
  });

  it('reports not-connected when no account exists', async () => {
    const [searchLeads] = createCloseTools('tenant-1');
    const result = await searchLeads.invoke({ query: 'acme' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-close:account:default', { data: { apiKey: 'enc(close-key)' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, false, 401));

    const [searchLeads] = createCloseTools('tenant-1');
    const result = await searchLeads.invoke({ query: 'acme' } as never);
    expect(result).toContain('Error searching Close leads');
    expect(result).toContain('401');
  });
});
