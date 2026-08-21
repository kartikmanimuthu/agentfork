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

import { asanaDescriptor, createAsanaTools } from './asana';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('asanaDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await asanaDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the name on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { name: 'Jane Doe' } }));
    const result = await asanaDescriptor.verify({ token: 'asana-pat' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('Jane Doe');
      expect(result.meta?.name).toBe('Jane Doe');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/users/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer asana-pat' }) }),
    );
  });

  it('fails when no name comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    const result = await asanaDescriptor.verify({ token: 'asana-pat' });
    expect(result.ok).toBe(false);
  });

  it('surfaces the Asana error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Not Authorized' }] }, false, 401));
    const result = await asanaDescriptor.verify({ token: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createAsanaTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const tools = createAsanaTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['asana_list_workspaces', 'asana_search_tasks', 'asana_get_task', 'asana_create_task']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [listWorkspaces] = createAsanaTools('tenant-1');
    const result = await listWorkspaces.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asana_list_workspaces calls the API once connected', async () => {
    store.set('claw-integration-asana:account:default', { data: { token: 'enc(asana-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ gid: 'w1', name: 'Acme Corp' }] }));

    const [listWorkspaces] = createAsanaTools('tenant-1');
    const result = await listWorkspaces.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/workspaces',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer asana-real' }) }),
    );
    expect(result).toContain('Acme Corp');
  });

  it('asana_search_tasks queries typeahead with resource_type, query, and count', async () => {
    store.set('claw-integration-asana:account:default', { data: { token: 'enc(asana-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ gid: 't1', name: 'Fix bug' }] }));

    const [, searchTasks] = createAsanaTools('tenant-1');
    const result = await searchTasks.invoke({ workspaceGid: 'w1', query: 'bug' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/workspaces/w1/typeahead?resource_type=task&query=bug&count=10',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer asana-real' }) }),
    );
    expect(result).toContain('Fix bug');
  });

  it('asana_get_task fetches a single task', async () => {
    store.set('claw-integration-asana:account:default', { data: { token: 'enc(asana-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { gid: 't1', name: 'Fix bug' } }));

    const [, , getTask] = createAsanaTools('tenant-1');
    const result = await getTask.invoke({ taskGid: 't1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks/t1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer asana-real' }) }),
    );
    expect(result).toContain('Fix bug');
  });

  it('asana_create_task posts name, notes, and projects', async () => {
    store.set('claw-integration-asana:account:default', { data: { token: 'enc(asana-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: { gid: 't2', name: 'New task' } }));

    const [, , , createTask] = createAsanaTools('tenant-1');
    const result = await createTask.invoke({ projectGid: 'p1', name: 'New task' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { name: 'New task', notes: '', projects: ['p1'] } }),
      }),
    );
    expect(result).toContain('New task');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-asana:account:default', { data: { token: 'enc(asana-real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Not Found' }] }, false, 404));

    const [listWorkspaces] = createAsanaTools('tenant-1');
    const result = await listWorkspaces.invoke({} as never);
    expect(result).toContain('Error listing Asana workspaces');
    expect(result).toContain('404');
  });
});
