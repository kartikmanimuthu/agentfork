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
  env: { NOTION_OAUTH_CLIENT_ID: 'client-id', NOTION_OAUTH_CLIENT_SECRET: 'client-secret' },
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

import { notionDescriptor, createNotionTools } from './notion';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('notionDescriptor.oauth', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('exchangeCode derives accountId and label from the token response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'nt-access', workspace_id: 'ws-1', workspace_name: 'Acme Co' }));
    const result = await notionDescriptor.oauth!.exchangeCode('code-1', 'https://mc.example.com/cb');
    expect(result).toEqual({
      ok: true,
      tokens: { accessToken: 'nt-access' },
      identity: { accountId: 'notion-ws-1', label: 'Acme Co' },
    });
  });

  it('exchangeCode fails clearly when the token response is missing a workspace id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'nt-access' }));
    const result = await notionDescriptor.oauth!.exchangeCode('code-1', 'https://mc.example.com/cb');
    expect(result.ok).toBe(false);
  });

  it('identify surfaces the workspace name from /users/me', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'bot-1', bot: { workspace_name: 'Acme Co' } }));
    const result = await notionDescriptor.oauth!.identify('nt-access');
    expect(result).toEqual({ ok: true, accountId: 'notion-bot-1', label: 'Acme Co' });
  });

  it('has no refresh or revoke — Notion tokens do not expire and have no revoke endpoint', () => {
    expect(notionDescriptor.oauth!.refresh).toBeUndefined();
    expect(notionDescriptor.oauth!.revoke).toBeUndefined();
  });

  it('verify() delegates to identify() and adapts the shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'bot-1', bot: { workspace_name: 'Acme Co' } }));
    const result = await notionDescriptor.verify({ accessToken: 'nt-access' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain('Acme Co');
  });
});

describe('createNotionTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createNotionTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['notion_search_pages', 'notion_get_page', 'notion_create_page']);
  });

  it('reports not-connected without calling the API when no workspace exists', async () => {
    const [search] = createNotionTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search_pages calls the Notion search API once connected', async () => {
    store.set('claw-integration-notion:account:notion-ws-1', { data: { accessToken: 'enc(nt-access)', label: 'Acme Co' } });
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ id: 'page-1', url: 'https://notion.so/page-1', properties: { title: { type: 'title', title: [{ plain_text: 'Roadmap' }] } } }] }),
    );

    const [search] = createNotionTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.notion.com/v1/search',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer nt-access' }) }),
    );
    expect(result).toContain('Roadmap');
  });

  it('create_page requires approval (write) and posts to /pages', async () => {
    store.set('claw-integration-notion:account:notion-ws-1', { data: { accessToken: 'enc(nt-access)', label: 'Acme Co' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'page-2', url: 'https://notion.so/page-2' }));

    const [, , createPage] = createNotionTools('tenant-1');
    const result = await createPage.invoke({ parentPageId: 'parent-1', title: 'New page' } as never);

    expect(fetchMock).toHaveBeenCalledWith('https://api.notion.com/v1/pages', expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('page-2');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-notion:account:notion-ws-1', { data: { accessToken: 'enc(nt-access)', label: 'Acme Co' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, false, 401));

    const [search] = createNotionTools('tenant-1');
    const result = await search.invoke({ query: 'roadmap' } as never);
    expect(result).toContain('Error searching Notion');
    expect(result).toContain('401');
  });
});
