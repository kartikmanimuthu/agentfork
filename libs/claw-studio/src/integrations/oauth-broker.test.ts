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

import { buildAuthorizeUrl, completeOAuthCallback } from './oauth-broker';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

function makeDescriptor(overrides: Partial<NonNullable<IntegrationDescriptor['oauth']>> = {}): IntegrationDescriptor {
  return {
    name: 'notion',
    displayName: 'Notion',
    description: 'test',
    accountMode: 'multi',
    authMode: 'oauth',
    secretFields: ['accessToken', 'refreshToken'],
    verify: async () => ({ ok: true, detail: 'ok' }),
    oauth: {
      authorizeUrl: 'https://example.com/authorize',
      tokenUrl: 'https://example.com/token',
      scopes: ['read', 'write'],
      clientId: () => 'client-123',
      clientSecret: () => 'secret-abc',
      extraAuthorizeParams: { owner: 'user' },
      exchangeCode: async () => ({ ok: true, tokens: { accessToken: 'access-1' } }),
      identify: async () => ({ ok: true, accountId: 'acct-1', label: 'My Workspace' }),
      ...overrides,
    },
  };
}

describe('buildAuthorizeUrl', () => {
  it('builds a URL with client_id, redirect_uri, scope, state, and extra params', () => {
    const descriptor = makeDescriptor();
    const url = buildAuthorizeUrl(descriptor, 'https://mc.example.com/api/integrations/notion/oauth/callback', 'signed-state');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://example.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://mc.example.com/api/integrations/notion/oauth/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('signed-state');
    expect(parsed.searchParams.get('scope')).toBe('read write');
    expect(parsed.searchParams.get('owner')).toBe('user');
  });

  it('omits the scope param when the provider has no scopes (Notion)', () => {
    const descriptor = makeDescriptor();
    descriptor.oauth!.scopes = [];
    const url = buildAuthorizeUrl(descriptor, 'https://mc.example.com/cb', 'state');
    expect(new URL(url).searchParams.has('scope')).toBe(false);
  });

  it('throws for a manual-auth descriptor with no oauth config', () => {
    const manual: IntegrationDescriptor = {
      name: 'github',
      displayName: 'GitHub',
      description: 'test',
      accountMode: 'single',
      authMode: 'manual',
      secretFields: ['token'],
      verify: async () => ({ ok: true, detail: 'ok' }),
    };
    expect(() => buildAuthorizeUrl(manual, 'https://mc.example.com/cb', 'state')).toThrow();
  });
});

describe('completeOAuthCallback', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('exchanges the code and saves the account using the identity from exchangeCode (Notion inline identity)', async () => {
    const descriptor = makeDescriptor({
      exchangeCode: async () => ({
        ok: true,
        tokens: { accessToken: 'access-1' },
        identity: { accountId: 'workspace-1', label: 'Acme Workspace' },
      }),
      identify: async () => {
        throw new Error('should not be called when exchangeCode already returns identity');
      },
    });

    const result = await completeOAuthCallback(descriptor, 'tenant-1', 'user-1', 'code-abc', 'https://mc.example.com/cb');
    expect(result).toEqual({ ok: true, accountId: 'workspace-1', label: 'Acme Workspace' });

    const configs = new IntegrationConfigService('tenant-1', descriptor);
    const resolved = await configs.resolveAccount('workspace-1');
    expect(resolved?.raw.accessToken).toBe('access-1');
  });

  it('falls back to identify() when exchangeCode does not carry identity', async () => {
    const descriptor = makeDescriptor();
    const result = await completeOAuthCallback(descriptor, 'tenant-1', 'user-1', 'code-abc', 'https://mc.example.com/cb');
    expect(result).toEqual({ ok: true, accountId: 'acct-1', label: 'My Workspace' });
  });

  it('stores refreshToken, expiresAt, and scope when present', async () => {
    const descriptor = makeDescriptor({
      exchangeCode: async () => ({
        ok: true,
        tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2030-01-01T00:00:00.000Z', scope: 'read write' },
      }),
    });
    await completeOAuthCallback(descriptor, 'tenant-1', 'user-1', 'code-abc', 'https://mc.example.com/cb');

    const configs = new IntegrationConfigService('tenant-1', descriptor);
    const raw = await configs.getRawAccount('acct-1');
    expect(raw).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'read write',
    });
  });

  it('returns ok:false without saving anything when exchangeCode fails', async () => {
    const descriptor = makeDescriptor({ exchangeCode: async () => ({ ok: false, error: 'invalid_grant' }) });
    const result = await completeOAuthCallback(descriptor, 'tenant-1', 'user-1', 'bad-code', 'https://mc.example.com/cb');
    expect(result).toEqual({ ok: false, error: 'invalid_grant' });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns ok:false without saving anything when identify() fails', async () => {
    const descriptor = makeDescriptor({ identify: async () => ({ ok: false, error: 'not authorized' }) });
    const result = await completeOAuthCallback(descriptor, 'tenant-1', 'user-1', 'code-abc', 'https://mc.example.com/cb');
    expect(result).toEqual({ ok: false, error: 'not authorized' });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
