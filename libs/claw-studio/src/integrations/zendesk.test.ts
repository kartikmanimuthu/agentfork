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

import { zendeskDescriptor, createZendeskTools } from './zendesk';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('zendeskDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('fails when a required field is missing', async () => {
    const result = await zendeskDescriptor.verify({ subdomain: 'acme', apiToken: 'tok' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the agent email on a valid token, using the /token username suffix', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { email: 'ada@acme.com', name: 'Ada Lovelace' } }));
    const result = await zendeskDescriptor.verify({ subdomain: 'acme', email: 'ada@acme.com', apiToken: 'tok' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('ada@acme.com');
      expect(result.meta?.identity).toBe('ada@acme.com');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://acme.zendesk.com/api/v2/users/me.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('ada@acme.com/token:tok').toString('base64')}`,
        }),
      }),
    );
  });

  it('fails when no user comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await zendeskDescriptor.verify({ subdomain: 'acme', email: 'ada@acme.com', apiToken: 'tok' });
    expect(result.ok).toBe(false);
  });

  it('surfaces the Zendesk error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Couldn\'t authenticate you' }, false, 401));
    const result = await zendeskDescriptor.verify({ subdomain: 'acme', email: 'ada@acme.com', apiToken: 'bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createZendeskTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createZendeskTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['zendesk_search', 'zendesk_get_ticket', 'zendesk_create_ticket']);
  });

  it('a read tool reports not-connected without calling the API when no account exists', async () => {
    const [search] = createZendeskTools('tenant-1');
    const result = await search.invoke({ query: 'refund' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zendesk_get_ticket calls the Zendesk API once connected', async () => {
    store.set('claw-integration-zendesk:account:default', {
      data: { subdomain: 'acme', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ ticket: { id: 42, subject: 'Refund request' } }));

    const tools = createZendeskTools('tenant-1');
    const getTicket = tools.find((t) => t.name === 'zendesk_get_ticket')!;
    const result = await getTicket.invoke({ ticketId: 42 } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://acme.zendesk.com/api/v2/tickets/42.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('ada@acme.com/token:tok').toString('base64')}`,
        }),
      }),
    );
    expect(result).toContain('Refund request');
  });

  it('zendesk_create_ticket sends subject/comment body and optional requester', async () => {
    store.set('claw-integration-zendesk:account:default', {
      data: { subdomain: 'acme', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ ticket: { id: 43 } }));

    const tools = createZendeskTools('tenant-1');
    const createTicket = tools.find((t) => t.name === 'zendesk_create_ticket')!;
    await createTicket.invoke({ subject: 'Help', body: 'I need help', requesterEmail: 'customer@example.com' } as never);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.ticket).toEqual({
      subject: 'Help',
      comment: { body: 'I need help' },
      requester: { email: 'customer@example.com' },
    });
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-zendesk:account:default', {
      data: { subdomain: 'acme', email: 'ada@acme.com', apiToken: 'enc(tok)' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'RecordNotFound' }, false, 404));

    const tools = createZendeskTools('tenant-1');
    const getTicket = tools.find((t) => t.name === 'zendesk_get_ticket')!;
    const result = await getTicket.invoke({ ticketId: 999 } as never);
    expect(result).toContain('Error fetching Zendesk ticket');
    expect(result).toContain('404');
  });
});
