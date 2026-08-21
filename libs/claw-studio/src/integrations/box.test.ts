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

import { boxDescriptor, createBoxTools } from './box';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body };
}

function connect() {
  store.set('claw-integration-box:account:default', { data: { accessToken: 'enc(box-real)' } });
}

describe('boxDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await boxDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the login on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ login: 'user@example.com' }));
    const result = await boxDescriptor.verify({ accessToken: 'box-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('user@example.com');
      expect(result.meta?.login).toBe('user@example.com');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.box.com/2.0/users/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer box-test' }) }),
    );
  });

  it('surfaces the Box error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Invalid access token' }, false, 401));
    const result = await boxDescriptor.verify({ accessToken: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Invalid access token');
  });
});

describe('createBoxTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set', () => {
    const names = createBoxTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['box_search', 'box_list_folder', 'box_read_file']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [search] = createBoxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search calls the Box search endpoint with query and limit params', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [{ name: 'report.pdf' }] }));

    const [search] = createBoxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.box.com/2.0/search?query=report&limit=10',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer box-real' }) }),
    );
    expect(result).toContain('report.pdf');
  });

  it('list_folder defaults to the root folder id "0"', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const [, listFolder] = createBoxTools('tenant-1');
    await listFolder.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.box.com/2.0/folders/0/items', expect.anything());
  });

  it('list_folder uses the given folder id', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const [, listFolder] = createBoxTools('tenant-1');
    await listFolder.invoke({ folderId: '12345' } as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.box.com/2.0/folders/12345/items', expect.anything());
  });

  it('read_file downloads raw content from the file content endpoint', async () => {
    connect();
    fetchMock.mockResolvedValue(textResponse('hello world'));

    const [, , readFile] = createBoxTools('tenant-1');
    const result = await readFile.invoke({ fileId: 'f1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.box.com/2.0/files/f1/content',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer box-real' }) }),
    );
    expect(result).toContain('hello world');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, false, 404));

    const [search] = createBoxTools('tenant-1');
    const result = await search.invoke({ query: 'report' } as never);
    expect(result).toContain('Error searching Box');
    expect(result).toContain('404');
  });
});
