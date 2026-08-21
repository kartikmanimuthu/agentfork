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
  env: { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' },
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

import { createGoogleCalendarTools } from './google-calendar';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function connect() {
  store.set('claw-integration-google_calendar:account:me@gmail.com', {
    data: { accessToken: 'enc(cal-access)', label: 'me@gmail.com' },
  });
}

describe('createGoogleCalendarTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated write names', () => {
    const names = createGoogleCalendarTools('tenant-1').map((t) => t.name);
    expect(names).toEqual([
      'google_calendar_list_events',
      'google_calendar_check_availability',
      'google_calendar_create_event',
      'google_calendar_update_event',
      'google_calendar_delete_event',
    ]);
  });

  it('reports not-connected without calling the API', async () => {
    const [list] = createGoogleCalendarTools('tenant-1');
    const result = await list.invoke({} as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('list_events calls the events endpoint with the bearer token', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ id: 'e1', summary: 'Standup' }] }));
    const [list] = createGoogleCalendarTools('tenant-1');
    const result = await list.invoke({} as never);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/primary/events'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer cal-access' }) }),
    );
    expect(result).toContain('Standup');
  });

  it('check_availability posts to freeBusy', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ calendars: { primary: { busy: [{ start: 't1', end: 't2' }] } } }));
    const [, checkAvailability] = createGoogleCalendarTools('tenant-1');
    const result = await checkAvailability.invoke({ timeMin: 't1', timeMax: 't2' } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/freeBusy'), expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('t1');
  });

  it('create_event posts the event payload', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ id: 'e2' }));
    const [, , createEvent] = createGoogleCalendarTools('tenant-1');
    const result = await createEvent.invoke({ summary: 'Sync', startDateTime: 't1', endDateTime: 't2' } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events'), expect.objectContaining({ method: 'POST' }));
    expect(result).toContain('e2');
  });

  it('delete_event issues a DELETE request', async () => {
    connect();
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' });
    const [, , , , deleteEvent] = createGoogleCalendarTools('tenant-1');
    const result = await deleteEvent.invoke({ eventId: 'e1' } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/events/e1'), expect.objectContaining({ method: 'DELETE' }));
    expect(result).toContain('Deleted');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    connect();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not found' }, false, 404));
    const [list] = createGoogleCalendarTools('tenant-1');
    const result = await list.invoke({} as never);
    expect(result).toContain('Error listing calendar events');
    expect(result).toContain('404');
  });
});
