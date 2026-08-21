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

import { mixpanelDescriptor, createMixpanelTools } from './mixpanel';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('mixpanelDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('keys the account by projectId and labels it with the username', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await mixpanelDescriptor.verify({ username: 'svc-acct', secret: 'shh', projectId: '99' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('99');
      expect(result.meta?.label).toContain('svc-acct');
    }
  });

  it('authenticates with HTTP Basic username:secret, not a bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await mixpanelDescriptor.verify({ username: 'svc-acct', secret: 'shh', projectId: '99' });
    const expectedAuth = `Basic ${Buffer.from('svc-acct:shh').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mixpanel.com/api/app/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
    );
  });

  it('fails when no projectId is given', async () => {
    const result = await mixpanelDescriptor.verify({ username: 'svc-acct', secret: 'shh' });
    expect(result.ok).toBe(false);
  });

  it('fails when credentials are missing', async () => {
    const result = await mixpanelDescriptor.verify({ projectId: '99' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createMixpanelTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('exposes only read tools', () => {
    const names = createMixpanelTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['mixpanel_segmentation', 'mixpanel_top_events']);
  });

  it('resolves the default project and sends Basic auth with projectId in params', async () => {
    store.set('claw-integration-mixpanel:account:99', {
      data: { username: 'svc-acct', secret: 'enc(shh)', projectId: '99' },
    });
    store.set('claw-integration-mixpanel:default', { data: { accountId: '99' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const [segmentation] = createMixpanelTools('tenant-1');
    await segmentation.invoke({ event: 'signup', fromDate: '2026-01-01', toDate: '2026-01-07' } as never);

    const expectedAuth = `Basic ${Buffer.from('svc-acct:shh').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('https://mixpanel.com/api/query/segmentation');
    expect(String(calledUrl)).toContain('projectId=99');
    expect(calledInit.headers.Authorization).toBe(expectedAuth);
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-mixpanel:account:99', { data: { username: 'svc-acct-1', secret: 'enc(shh1)', projectId: '99' } });
    store.set('claw-integration-mixpanel:account:100', { data: { username: 'svc-acct-2', secret: 'enc(shh2)', projectId: '100' } });
    store.set('claw-integration-mixpanel:default', { data: { accountId: '99' } });
    fetchMock.mockResolvedValue(jsonResponse({}));

    const [, topEvents] = createMixpanelTools('tenant-1');
    await topEvents.invoke({ account: '100' } as never);

    const expectedAuth = `Basic ${Buffer.from('svc-acct-2:shh2').toString('base64')}`;
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('projectId=100');
    expect(calledInit.headers.Authorization).toBe(expectedAuth);
  });

  it('reports not-connected when no project exists', async () => {
    const [segmentation] = createMixpanelTools('tenant-1');
    const result = await segmentation.invoke({ event: 'signup', fromDate: '2026-01-01', toDate: '2026-01-07' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a descriptive error string instead of throwing on API failure', async () => {
    store.set('claw-integration-mixpanel:account:99', { data: { username: 'svc-acct', secret: 'enc(shh)', projectId: '99' } });
    store.set('claw-integration-mixpanel:default', { data: { accountId: '99' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 401));

    const [segmentation] = createMixpanelTools('tenant-1');
    const result = await segmentation.invoke({ event: 'signup', fromDate: '2026-01-01', toDate: '2026-01-07' } as never);
    expect(result).toContain('Error querying Mixpanel segmentation');
  });
});
