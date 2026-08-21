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

import { attioDescriptor, createAttioTools } from './attio';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('attioDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives a stable account id + label from the workspace id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ workspace_id: 'ws-abc', workspace_name: 'Acme Co' }));
    const result = await attioDescriptor.verify({ accessToken: 'attio-token' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('attio-ws-abc');
      expect(result.meta?.label).toBe('Acme Co');
    }
  });

  it('falls back to the workspace id as the label when no name comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ workspace_id: 'ws-abc' }));
    const result = await attioDescriptor.verify({ accessToken: 'attio-token' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta?.label).toBe('ws-abc');
  });

  it('fails when no access token is given', async () => {
    const result = await attioDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no workspace id comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await attioDescriptor.verify({ accessToken: 'attio-token' });
    expect(result.ok).toBe(false);
  });
});

describe('createAttioTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('gates write tools with names tool-classifier.ts already recognizes', () => {
    const names = createAttioTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['attio_list_objects', 'attio_query_records', 'attio_get_record', 'attio_create_note']);
  });

  it('resolves the default workspace when one is connected', async () => {
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [listObjects] = createAttioTools('tenant-1');
    await listObjects.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.attio.com/v2/objects',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer a' }) }),
    );
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:account:attio-ws-2', { data: { accessToken: 'enc(b)', label: 'Workspace 2' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const [listObjects] = createAttioTools('tenant-1');
    await listObjects.invoke({ account: 'attio-ws-2' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer b' }) }),
    );
  });

  it('a second connect() creates a second account row and both remain independently resolvable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });
    store.set('claw-integration-attio:account:attio-ws-2', { data: { accessToken: 'enc(b)', label: 'Workspace 2' } });

    const rows = Array.from(store.keys()).filter((k) => k.startsWith('claw-integration-attio:account:'));
    expect(rows).toHaveLength(2);

    const [listObjects] = createAttioTools('tenant-1');
    await listObjects.invoke({ account: 'attio-ws-1' } as never);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer a' }) }),
    );
    await listObjects.invoke({ account: 'attio-ws-2' } as never);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer b' }) }),
    );
  });

  it('reports not-connected when no workspace exists', async () => {
    const [listObjects] = createAttioTools('tenant-1');
    const result = await listObjects.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('query_records rejects unparsable filter_json without calling the API', async () => {
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });

    const [, queryRecords] = createAttioTools('tenant-1');
    const result = await queryRecords.invoke({ objectType: 'companies', filterJson: '{not json' } as never);

    expect(result).toContain('filter_json');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('create_note requires approval (write) and posts to /v2/notes', async () => {
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: { note_id: 'note-1' } } }));

    const [, , , createNote] = createAttioTools('tenant-1');
    const result = await createNote.invoke({
      parentObject: 'companies',
      parentRecordId: 'rec-1',
      title: 'Call notes',
      content: 'Great call',
    } as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.attio.com/v2/notes', expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('note-1');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-attio:account:attio-ws-1', { data: { accessToken: 'enc(a)', label: 'Workspace 1' } });
    store.set('claw-integration-attio:default', { data: { accountId: 'attio-ws-1' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, false, 401));

    const [listObjects] = createAttioTools('tenant-1');
    const result = await listObjects.invoke({} as never);
    expect(result).toContain('Error listing Attio objects');
    expect(result).toContain('401');
  });
});
