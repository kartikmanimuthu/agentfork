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

import { clickupDescriptor, createClickupTools } from './clickup';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('clickupDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects a missing token without calling the API', async () => {
    const result = await clickupDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the username on a valid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { username: 'jdoe' } }));
    const result = await clickupDescriptor.verify({ apiToken: 'pk_test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('jdoe');
      expect(result.meta?.username).toBe('jdoe');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_test' }) }),
    );
  });

  it('fails when no username comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: {} }));
    const result = await clickupDescriptor.verify({ apiToken: 'pk_test' });
    expect(result.ok).toBe(false);
  });

  it('surfaces the ClickUp error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err: 'Invalid token' }, false, 401));
    const result = await clickupDescriptor.verify({ apiToken: 'bad-token' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createClickupTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const tools = createClickupTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'clickup_list_teams',
      'clickup_list_spaces',
      'clickup_list_lists',
      'clickup_list_tasks',
      'clickup_get_task',
      'clickup_create_task',
      'clickup_update_task',
      'clickup_add_comment',
    ]);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [listTeams] = createClickupTools('tenant-1');
    const result = await listTeams.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clickup_list_teams calls the API once connected', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ teams: [{ id: '1', name: 'Acme' }] }));

    const [listTeams] = createClickupTools('tenant-1');
    const result = await listTeams.invoke({} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/team',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_real' }) }),
    );
    expect(result).toContain('Acme');
  });

  it('clickup_list_spaces fetches spaces for a team', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ spaces: [{ id: 's1', name: 'Engineering' }] }));

    const [, listSpaces] = createClickupTools('tenant-1');
    const result = await listSpaces.invoke({ teamId: 'team-1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/team/team-1/space',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_real' }) }),
    );
    expect(result).toContain('Engineering');
  });

  it('clickup_list_lists fetches lists for a space', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ lists: [{ id: 'l1', name: 'Sprint' }] }));

    const [, , listLists] = createClickupTools('tenant-1');
    const result = await listLists.invoke({ spaceId: 'space-1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/space/space-1/list',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_real' }) }),
    );
    expect(result).toContain('Sprint');
  });

  it('clickup_list_tasks fetches tasks for a list with include_closed and page params', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ tasks: [{ id: 't1', name: 'Fix bug' }] }));

    const [, , , listTasks] = createClickupTools('tenant-1');
    const result = await listTasks.invoke({ listId: 'list-1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/list/list-1/task?include_closed=false&page=0',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_real' }) }),
    );
    expect(result).toContain('Fix bug');
  });

  it('clickup_get_task fetches a single task with subtasks', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 't1', name: 'Fix bug' }));

    const [, , , , getTask] = createClickupTools('tenant-1');
    const result = await getTask.invoke({ taskId: 't1' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/t1?include_subtasks=true',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'pk_real' }) }),
    );
    expect(result).toContain('Fix bug');
  });

  it('clickup_create_task posts name and description to the list', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 't2', name: 'New task' }));

    const [, , , , , createTask] = createClickupTools('tenant-1');
    const result = await createTask.invoke({ listId: 'list-1', name: 'New task' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/list/list-1/task',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New task', description: '' }),
      }),
    );
    expect(result).toContain('New task');
  });

  it('clickup_update_task refuses to call the API with no fields to update', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });

    const [, , , , , , updateTask] = createClickupTools('tenant-1');
    const result = await updateTask.invoke({ taskId: 't1' } as never);

    expect(result).toContain('Nothing to update');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clickup_update_task PUTs only the provided fields', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 't1', status: 'complete' }));

    const [, , , , , , updateTask] = createClickupTools('tenant-1');
    const result = await updateTask.invoke({ taskId: 't1', status: 'complete' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/t1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ status: 'complete' }) }),
    );
    expect(result).toContain('complete');
  });

  it('clickup_add_comment posts comment_text to the task', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'c1' }));

    const [, , , , , , , addComment] = createClickupTools('tenant-1');
    const result = await addComment.invoke({ taskId: 't1', text: 'Looks good' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/task/t1/comment',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ comment_text: 'Looks good' }) }),
    );
    expect(result).toContain('c1');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-clickup:account:default', { data: { apiToken: 'enc(pk_real)' } });
    fetchMock.mockResolvedValue(jsonResponse({ err: 'Team not found' }, false, 404));

    const [listTeams] = createClickupTools('tenant-1');
    const result = await listTeams.invoke({} as never);
    expect(result).toContain('Error listing ClickUp teams');
    expect(result).toContain('404');
  });
});
