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

import { githubDescriptor, createGithubTools } from './github';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('githubDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await githubDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the login on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ login: 'octocat' }));
    const result = await githubDescriptor.verify({ token: 'ghp-test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('octocat');
      expect(result.meta?.login).toBe('octocat');
    }
  });

  it('surfaces the GitHub error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, false, 401));
    const result = await githubDescriptor.verify({ token: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createGithubTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const tools = createGithubTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'github_list_issues',
      'github_get_issue',
      'github_search_repos',
      'github_create_issue',
      'github_create_comment',
    ]);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [listIssues] = createGithubTools('tenant-1');
    const result = await listIssues.invoke({ owner: 'acme', repo: 'widgets' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a read tool calls the GitHub API once connected', async () => {
    store.set('claw-integration-github:account:default', { data: { token: 'enc(ghp-real)' } });
    fetchMock.mockResolvedValue(jsonResponse([{ number: 1, title: 'Bug' }]));

    const [listIssues] = createGithubTools('tenant-1');
    const result = await listIssues.invoke({ owner: 'acme', repo: 'widgets' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/widgets/issues?state=open&per_page=20',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghp-real' }) }),
    );
    expect(result).toContain('Bug');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-github:account:default', { data: { token: 'enc(ghp-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, false, 404));

    const [listIssues] = createGithubTools('tenant-1');
    const result = await listIssues.invoke({ owner: 'acme', repo: 'widgets' } as never);
    expect(result).toContain('Error listing GitHub issues');
    expect(result).toContain('404');
  });
});
