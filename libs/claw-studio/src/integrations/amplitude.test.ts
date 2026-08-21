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

import { amplitudeDescriptor, createAmplitudeTools } from './amplitude';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('amplitudeDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('names the account after the API key tail, since the API returns no identity', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await amplitudeDescriptor.verify({ apiKey: 'ampkey-abc123', secretKey: 'shh' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta?.accountId).toBe('key …abc123');
      expect(result.meta?.label).toBe('key …abc123');
    }
  });

  it('authenticates with HTTP Basic apiKey:secretKey', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await amplitudeDescriptor.verify({ apiKey: 'ampkey-abc123', secretKey: 'shh' });
    const expectedAuth = `Basic ${Buffer.from('ampkey-abc123:shh').toString('base64')}`;
    expect(fetchMock).toHaveBeenCalledWith(
      'https://amplitude.com/api/2/annotations',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
    );
  });

  it('two different API keys produce two distinguishable account ids', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const first = await amplitudeDescriptor.verify({ apiKey: 'ampkey-aaaaaa', secretKey: 'shh' });
    const second = await amplitudeDescriptor.verify({ apiKey: 'ampkey-bbbbbb', secretKey: 'shh' });
    expect(first.ok && second.ok && first.meta?.accountId).not.toBe(second.ok && first.ok && second.meta?.accountId);
  });

  it('fails when credentials are missing', async () => {
    const result = await amplitudeDescriptor.verify({ apiKey: 'ampkey-abc123' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error when Basic auth is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid' }, false, 401));
    const result = await amplitudeDescriptor.verify({ apiKey: 'ampkey-abc123', secretKey: 'wrong' });
    expect(result.ok).toBe(false);
  });
});

describe('createAmplitudeTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('exposes only read tools', () => {
    const names = createAmplitudeTools('tenant-1').map((t) => t.name);
    expect(names).toEqual(['amplitude_active_users', 'amplitude_event_totals']);
  });

  it('resolves the default project and sends Basic auth with normalized dates', async () => {
    store.set('claw-integration-amplitude:account:key …abc123', {
      data: { apiKey: 'enc(ampkey-abc123)', secretKey: 'enc(shh)' },
    });
    store.set('claw-integration-amplitude:default', { data: { accountId: 'key …abc123' } });
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    const [activeUsers] = createAmplitudeTools('tenant-1');
    await activeUsers.invoke({ start: '2026-01-01', end: '2026-01-07' } as never);

    const expectedAuth = `Basic ${Buffer.from('ampkey-abc123:shh').toString('base64')}`;
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('https://amplitude.com/api/2/users');
    expect(String(calledUrl)).toContain('start=20260101');
    expect(String(calledUrl)).toContain('end=20260107');
    expect(calledInit.headers.Authorization).toBe(expectedAuth);
  });

  it('honors an explicit account argument over the default', async () => {
    store.set('claw-integration-amplitude:account:key …aaaaaa', { data: { apiKey: 'enc(ampkey-aaaaaa)', secretKey: 'enc(shh1)' } });
    store.set('claw-integration-amplitude:account:key …bbbbbb', { data: { apiKey: 'enc(ampkey-bbbbbb)', secretKey: 'enc(shh2)' } });
    store.set('claw-integration-amplitude:default', { data: { accountId: 'key …aaaaaa' } });
    fetchMock.mockResolvedValue(jsonResponse({}));

    const [, eventTotals] = createAmplitudeTools('tenant-1');
    await eventTotals.invoke({ eventType: 'signup', start: '2026-01-01', end: '2026-01-07', account: 'key …bbbbbb' } as never);

    const expectedAuth = `Basic ${Buffer.from('ampkey-bbbbbb:shh2').toString('base64')}`;
    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.headers.Authorization).toBe(expectedAuth);
  });

  it('reports not-connected when no project exists', async () => {
    const [activeUsers] = createAmplitudeTools('tenant-1');
    const result = await activeUsers.invoke({ start: '2026-01-01', end: '2026-01-07' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a descriptive error string instead of throwing on API failure', async () => {
    store.set('claw-integration-amplitude:account:key …abc123', {
      data: { apiKey: 'enc(ampkey-abc123)', secretKey: 'enc(shh)' },
    });
    store.set('claw-integration-amplitude:default', { data: { accountId: 'key …abc123' } });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500));

    const [activeUsers] = createAmplitudeTools('tenant-1');
    const result = await activeUsers.invoke({ start: '2026-01-01', end: '2026-01-07' } as never);
    expect(result).toContain('Error fetching Amplitude active users');
  });
});
