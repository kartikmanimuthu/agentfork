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

import { gitlabDescriptor, createGitlabTools } from './gitlab';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('gitlabDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await gitlabDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the username on a valid token, defaulting to gitlab.com', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ username: 'octocat' }));
    const result = await gitlabDescriptor.verify({ token: 'glpat-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('@octocat');
      expect(result.meta?.username).toBe('octocat');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/user',
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-test' }) }),
    );
  });

  it('uses a self-hosted baseUrl when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ username: 'ada' }));
    await gitlabDescriptor.verify({ token: 'tok', baseUrl: 'https://gitlab.example.com' });
    expect(fetchMock).toHaveBeenCalledWith('https://gitlab.example.com/api/v4/user', expect.any(Object));
  });

  it('surfaces the GitLab error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: '401 Unauthorized' }, false, 401));
    const result = await gitlabDescriptor.verify({ token: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createGitlabTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createGitlabTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['gitlab_search', 'gitlab_get_issue', 'gitlab_get_merge_request', 'gitlab_create_issue']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [search] = createGitlabTools('tenant-1');
    const result = await search.invoke({ query: 'widgets' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gitlab_search calls the GitLab API once connected', async () => {
    store.set('claw-integration-gitlab:account:default', { data: { token: 'enc(glpat-real)' } });
    fetchMock.mockResolvedValue(jsonResponse([{ iid: 1, title: 'Bug' }]));

    const [search] = createGitlabTools('tenant-1');
    const result = await search.invoke({ query: 'widgets' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://gitlab.com/api/v4/search?'),
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-real' }) }),
    );
    expect(result).toContain('Bug');
  });

  it('gitlab_get_merge_request URL-encodes the project path', async () => {
    store.set('claw-integration-gitlab:account:default', { data: { token: 'enc(glpat-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ iid: 5, title: 'Add feature' }));

    const tools = createGitlabTools('tenant-1');
    const getMr = tools.find((t) => t.name === 'gitlab_get_merge_request')!;
    await getMr.invoke({ project: 'group/repo', mrIid: 5 } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/group%2Frepo/merge_requests/5',
      expect.any(Object),
    );
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-gitlab:account:default', { data: { token: 'enc(glpat-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, false, 404));

    const [search] = createGitlabTools('tenant-1');
    const result = await search.invoke({ query: 'widgets' } as never);
    expect(result).toContain('Error searching GitLab');
    expect(result).toContain('404');
  });
});
