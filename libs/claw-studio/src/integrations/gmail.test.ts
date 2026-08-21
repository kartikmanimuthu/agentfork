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

import { gmailDescriptor, createGmailTools } from './gmail';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('createGmailTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns the expected tool set with correctly gated names', () => {
    const names = createGmailTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['gmail_search_messages', 'gmail_get_message', 'gmail_send_message']);
  });

  it('reports not-connected without calling the API when no mailbox exists', async () => {
    const [search] = createGmailTools('tenant-1');
    const result = await search.invoke({ query: 'is:unread' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search_messages lists then fetches metadata for each message', async () => {
    store.set('claw-integration-gmail:account:me@gmail.com', { data: { accessToken: 'enc(gm-access)', label: 'me@gmail.com' } });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'm1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'm1', snippet: 'hello', payload: { headers: [{ name: 'Subject', value: 'Hi there' }] } }),
      );

    const [search] = createGmailTools('tenant-1');
    const result = await search.invoke({ query: 'is:unread' } as never);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/messages?q=is%3Aunread'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gm-access' }) }),
    );
    expect(result).toContain('Hi there');
  });

  it('send_message base64url-encodes a raw RFC822 message', async () => {
    store.set('claw-integration-gmail:account:me@gmail.com', { data: { accessToken: 'enc(gm-access)', label: 'me@gmail.com' } });
    fetchMock.mockResolvedValue(jsonResponse({ id: 'sent-1' }));

    const [, , send] = createGmailTools('tenant-1');
    const result = await send.invoke({ to: 'x@y.com', subject: 'Hi', body: 'test' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.raw).not.toMatch(/[+/=]/); // base64url, not base64
    expect(result).toContain('sent-1');
  });

  it('a failed API call returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-gmail:account:me@gmail.com', { data: { accessToken: 'enc(gm-access)', label: 'me@gmail.com' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'insufficient scope' }, false, 403));

    const [search] = createGmailTools('tenant-1');
    const result = await search.invoke({ query: 'is:unread' } as never);
    expect(result).toContain('Error searching Gmail');
    expect(result).toContain('403');
  });

  it('descriptor requests read + send scopes and forces consent for a refresh token', () => {
    expect(gmailDescriptor.oauth!.scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
    expect(gmailDescriptor.oauth!.extraAuthorizeParams).toEqual({ access_type: 'offline', prompt: 'consent' });
  });
});
