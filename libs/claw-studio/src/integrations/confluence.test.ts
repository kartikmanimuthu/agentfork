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

import { confluenceDescriptor, createConfluenceTools } from './confluence';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('confluenceDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('fails when a required field is missing', async () => {
    const result = await confluenceDescriptor.verify({ baseUrl: 'https://acme.atlassian.net', apiToken: 'tok' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the display name on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ displayName: 'Ada Lovelace', email: 'ada@acme.com' }));
    const result = await confluenceDescriptor.verify({
      baseUrl: 'https://acme.atlassian.net',
      email: 'ada@acme.com',
      apiToken: 'tok',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('Ada Lovelace');
      expect(result.meta?.displayName).toBe('Ada Lovelace');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://acme.atlassian.net/wiki/rest/api/user/current',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('ada@acme.com:tok').toString('base64')}`,
        }),
      }),
    );
  });

  it('fails when no displayName or email comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await confluenceDescriptor.verify({
      baseUrl: 'https://acme.atlassian.net',
      email: 'ada@acme.com',
      apiToken: 'tok',
    });
    expect(result.ok).toBe(false);
  });

  it('surfaces the Confluence error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, false, 401));
    const result = await confluenceDescriptor.verify({
      baseUrl: 'https://acme.atlassian.net',
      email: 'ada@acme.com',
      apiToken: 'bad',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createConfluenceTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createConfluenceTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['confluence_search', 'confluence_get_page', 'confluence_create_page']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [search] = createConfluenceTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confluence_search calls the Confluence API once connected', async () => {
    store.set('claw-integration-confluence:account:default', {
      data: { baseUrl: 'https://acme.atlassian.net', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ title: 'Roadmap 2026' }] }));

    const [search] = createConfluenceTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://acme.atlassian.net/wiki/rest/api/search?'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('ada@acme.com:tok').toString('base64')}`,
        }),
      }),
    );
    expect(result).toContain('Roadmap 2026');
  });

  it('confluence_create_page sends storage-format body and space key', async () => {
    store.set('claw-integration-confluence:account:default', {
      data: { baseUrl: 'https://acme.atlassian.net', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ id: '123', title: 'New Page' }));

    const tools = createConfluenceTools('tenant-1');
    const createPage = tools.find((t) => t.name === 'confluence_create_page')!;
    await createPage.invoke({ spaceKey: 'ENG', title: 'New Page', body: '<p>hello</p>' } as never);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.space).toEqual({ key: 'ENG' });
    expect(body.body.storage).toEqual({ value: '<p>hello</p>', representation: 'storage' });
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-confluence:account:default', {
      data: { baseUrl: 'https://acme.atlassian.net', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, false, 404));

    const [search] = createConfluenceTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);
    expect(result).toContain('Error searching Confluence');
    expect(result).toContain('404');
  });
});
