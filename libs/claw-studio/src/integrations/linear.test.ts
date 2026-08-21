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

import { linearDescriptor, createLinearTools } from './linear';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('linearDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing api key without calling the API', async () => {
    const result = await linearDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the viewer name on a valid key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { viewer: { name: 'Ada Lovelace' } } }));
    const result = await linearDescriptor.verify({ apiKey: 'lin_api_test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('Ada Lovelace');
      expect(result.meta?.name).toBe('Ada Lovelace');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'lin_api_test' }) }),
    );
  });

  it('fails when no viewer name comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { viewer: {} } }));
    const result = await linearDescriptor.verify({ apiKey: 'lin_api_test' });
    expect(result.ok).toBe(false);
  });

  it('surfaces the Linear error body on a rejected key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Authentication required' }] }, false, 401));
    const result = await linearDescriptor.verify({ apiKey: 'bad-key' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createLinearTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createLinearTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['linear_search_issues', 'linear_get_issue', 'linear_list_teams', 'linear_create_issue']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [searchIssues] = createLinearTools('tenant-1');
    const result = await searchIssues.invoke({ query: 'bug' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('linear_search_issues calls the Linear GraphQL API once connected', async () => {
    store.set('claw-integration-linear:account:default', { data: { apiKey: 'enc(lin_api_real)' } });
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { searchIssues: { nodes: [{ identifier: 'ENG-1', title: 'Fix bug', url: 'https://linear.app/x' }] } },
      }),
    );

    const [searchIssues] = createLinearTools('tenant-1');
    const result = await searchIssues.invoke({ query: 'bug' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'lin_api_real' }) }),
    );
    expect(result).toContain('Fix bug');
  });

  it('linear_list_teams returns team data', async () => {
    store.set('claw-integration-linear:account:default', { data: { apiKey: 'enc(lin_api_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { teams: { nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }] } } }));

    const tools = createLinearTools('tenant-1');
    const listTeams = tools.find((t) => t.name === 'linear_list_teams')!;
    const result = await listTeams.invoke({} as never);
    expect(result).toContain('Engineering');
  });

  it('linear_create_issue sends teamId/title/description in the mutation variables', async () => {
    store.set('claw-integration-linear:account:default', { data: { apiKey: 'enc(lin_api_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { issueCreate: { success: true, issue: { identifier: 'ENG-2' } } } }));

    const tools = createLinearTools('tenant-1');
    const createIssue = tools.find((t) => t.name === 'linear_create_issue')!;
    await createIssue.invoke({ teamId: 'team-1', title: 'New issue', description: 'Details' } as never);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.variables.input).toEqual({ teamId: 'team-1', title: 'New issue', description: 'Details' });
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-linear:account:default', { data: { apiKey: 'enc(lin_api_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Bad request' }] }, false, 400));

    const [searchIssues] = createLinearTools('tenant-1');
    const result = await searchIssues.invoke({ query: 'bug' } as never);
    expect(result).toContain('Error searching Linear issues');
    expect(result).toContain('400');
  });
});
