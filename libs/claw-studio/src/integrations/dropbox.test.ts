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

import { dropboxDescriptor, createDropboxTools } from './dropbox';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body };
}

function connect() {
  store.set('claw-integration-dropbox:account:default', { data: { accessToken: 'enc(dbx-real)' } });
}

describe('dropboxDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await dropboxDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the email on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'user@example.com' }));
    const result = await dropboxDescriptor.verify({ accessToken: 'dbx-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('user@example.com');
      expect(result.meta?.email).toBe('user@example.com');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/users/get_current_account',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer dbx-test' }) }),
    );
  });

  it('surfaces the Dropbox error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error_summary: 'invalid_access_token/...' }, false, 401));
    const result = await dropboxDescriptor.verify({ accessToken: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid_access_token');
  });
});

describe('createDropboxTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set', () => {
    const names = createDropboxTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['dropbox_search', 'dropbox_list_folder', 'dropbox_read_file']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [search] = createDropboxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search POSTs a JSON body to search_v2', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ matches: [{ metadata: { name: 'report.txt' } }] }));

    const [search] = createDropboxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/files/search_v2',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dbx-real', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: 'report', options: { max_results: 10 } }),
      }),
    );
    expect(result).toContain('report.txt');
  });

  it('list_folder normalizes an empty path to the root (empty string, not "/")', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const [, listFolder] = createDropboxTools('tenant-1');
    await listFolder.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/files/list_folder',
      expect.objectContaining({ body: JSON.stringify({ path: '' }) }),
    );
  });

  it('list_folder normalizes a bare (non-leading-slash) path', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const [, listFolder] = createDropboxTools('tenant-1');
    await listFolder.invoke({ path: 'Reports' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/files/list_folder',
      expect.objectContaining({ body: JSON.stringify({ path: '/Reports' }) }),
    );
  });

  it('read_file downloads via the content API using the Dropbox-API-Arg header, not a JSON body', async () => {
    connect();
    fetchMock.mockResolvedValue(textResponse('hello world'));

    const [, , readFile] = createDropboxTools('tenant-1');
    const result = await readFile.invoke({ path: '/notes.txt' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://content.dropboxapi.com/2/files/download',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer dbx-real',
          'Dropbox-API-Arg': JSON.stringify({ path: '/notes.txt' }),
        }),
      }),
    );
    expect(result).toContain('hello world');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ error_summary: 'path/not_found/...' }, false, 409));

    const [search] = createDropboxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);
    expect(result).toContain('Error searching Dropbox');
    expect(result).toContain('409');
  });
});
