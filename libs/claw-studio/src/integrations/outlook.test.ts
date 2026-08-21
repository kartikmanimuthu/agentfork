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
  env: { MICROSOFT_OAUTH_CLIENT_ID: 'client-id', MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret' },
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

import { createOutlookTools } from './outlook';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function connect() {
  store.set('claw-integration-outlook:account:me@work.com', {
    data: { accessToken: 'enc(ol-access)', label: 'me@work.com' },
  });
}

describe('createOutlookTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createOutlookTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['outlook_search_messages', 'outlook_list_events', 'outlook_send_message', 'outlook_create_event']);
  });

  it('reports not-connected without calling the API', async () => {
    const [search] = createOutlookTools('tenant-1');
    const result = await search.invoke({ query: 'invoice' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search_messages sends the ConsistencyLevel header $search requires', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ value: [{ id: 'm1', subject: 'Invoice', from: { emailAddress: { address: 'a@b.com' } } }] }));
    const [search] = createOutlookTools('tenant-1');
    const result = await search.invoke({ query: 'invoice' } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages?'),
      expect.objectContaining({ headers: expect.objectContaining({ ConsistencyLevel: 'eventual' }) }),
    );
    expect(result).toContain('Invoice');
  });

  it('send_message posts to /sendMail', async () => {
    connect();
    fetchMock.mockResolvedValue({ ok: true, status: 202, text: async () => '' });
    const [, , send] = createOutlookTools('tenant-1');
    const result = await send.invoke({ to: 'x@y.com', subject: 'Hi', body: 'test' } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/sendMail'), expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('x@y.com');
  });

  it('create_event posts to /events with attendees', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'e1' }));
    const [, , , createEvent] = createOutlookTools('tenant-1');
    const result = await createEvent.invoke({
      subject: 'Sync',
      startDateTime: '2030-01-01T10:00:00Z',
      endDateTime: '2030-01-01T11:00:00Z',
      attendees: ['a@b.com'],
    } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events'), expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('e1');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'forbidden' } }, false, 403));
    const [search] = createOutlookTools('tenant-1');
    const result = await search.invoke({ query: 'invoice' } as never);
    expect(result).toContain('Error searching Outlook mail');
    expect(result).toContain('403');
  });
});
