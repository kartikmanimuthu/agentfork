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

import { jiraDescriptor, createJiraTools } from './jira';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('jiraDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('derives a stable account id + label from the site host', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accountId: 'acc-1', displayName: 'Ada Lovelace' }));
    const result = await jiraDescriptor.verify({ site: 'acme', email: 'ada@acme.com', apiToken: 'tok' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('jira-acme.atlassian.net');
      expect(result.meta?.label).toBe('acme.atlassian.net');
    }
  });

  it('accepts a full custom domain as the site', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accountId: 'acc-1' }));
    const result = await jiraDescriptor.verify({ site: 'jira.example.com', email: 'a@b.com', apiToken: 'tok' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.meta?.accountId).toBe('jira-jira.example.com');
  });

  it('fails when no accountId comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await jiraDescriptor.verify({ site: 'acme', email: 'a@b.com', apiToken: 'tok' });
    expect(result.ok).toBe(false);
  });

  it('fails when a required field is missing', async () => {
    const result = await jiraDescriptor.verify({ site: 'acme', apiToken: 'tok' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createJiraTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('gates write tools with names tool-classifier.ts already recognizes', () => {
    const names = createJiraTools('tenant-1').map((t) => t.name);
    expect(names).toEqual([
      'jira_search_issues',
      'jira_get_issue',
      'jira_list_projects',
      'jira_create_issue',
      'jira_add_comment',
    ]);
  });

  it('resolves the default site when multiple are connected and none is named', async () => {
    store.set('claw-integration-jira:account:jira-a.atlassian.net', {
      data: { site: 'a.atlassian.net', email: 'a@a.com', apiToken: 'enc(tok-a)', label: 'a.atlassian.net' },
    });
    store.set('claw-integration-jira:account:jira-b.atlassian.net', {
      data: { site: 'b.atlassian.net', email: 'b@b.com', apiToken: 'enc(tok-b)', label: 'b.atlassian.net' },
    });
    store.set('claw-integration-jira:default', { data: { accountId: 'jira-a.atlassian.net' } });
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

    const [searchIssues] = createJiraTools('tenant-1');
    await searchIssues.invoke({ jql: 'project = ENG' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://a.atlassian.net/rest/api/3/search/jql',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('a@a.com:tok-a').toString('base64')}` }),
      }),
    );
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-jira:account:jira-a.atlassian.net', {
      data: { site: 'a.atlassian.net', email: 'a@a.com', apiToken: 'enc(tok-a)', label: 'a.atlassian.net' },
    });
    store.set('claw-integration-jira:account:jira-b.atlassian.net', {
      data: { site: 'b.atlassian.net', email: 'b@b.com', apiToken: 'enc(tok-b)', label: 'b.atlassian.net' },
    });
    store.set('claw-integration-jira:default', { data: { accountId: 'jira-a.atlassian.net' } });
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

    const [searchIssues] = createJiraTools('tenant-1');
    await searchIssues.invoke({ jql: 'project = ENG', account: 'jira-b.atlassian.net' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://b.atlassian.net/rest/api/3/search/jql',
      expect.any(Object),
    );
  });

  it('reports not-connected when no site exists', async () => {
    const [searchIssues] = createJiraTools('tenant-1');
    const result = await searchIssues.invoke({ jql: 'project = ENG' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends issue create bodies in Atlassian Document Format, not plain strings', async () => {
    store.set('claw-integration-jira:account:jira-a.atlassian.net', {
      data: { site: 'a.atlassian.net', email: 'a@a.com', apiToken: 'enc(tok-a)', label: 'a.atlassian.net' },
    });
    store.set('claw-integration-jira:default', { data: { accountId: 'jira-a.atlassian.net' } });
    fetchMock.mockResolvedValue(jsonResponse({ key: 'ENG-1' }));

    const tools = createJiraTools('tenant-1');
    const createIssue = tools.find((t) => t.name === 'jira_create_issue')!;
    await createIssue.invoke({ projectKey: 'ENG', summary: 'Fix bug', description: 'It is broken' } as never);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.fields.description).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It is broken' }] }],
    });
  });
});
