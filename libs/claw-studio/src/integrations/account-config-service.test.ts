import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Row {
  data: Record<string, unknown>;
  updatedAt: Date;
  updatedBy: string;
}

const store = new Map<string, Row>();
let clock = 0;

const mockGet = vi.fn(async (key: string) => store.get(key)?.data ?? null);
const mockSet = vi.fn(async (key: string, value: Record<string, unknown>, updatedBy = 'system') => {
  clock += 1;
  store.set(key, { data: value, updatedAt: new Date(clock), updatedBy });
});
const mockDelete = vi.fn(async (key: string) => {
  store.delete(key);
});
const mockListByPrefix = vi.fn(async (prefix: string) => {
  return Array.from(store.entries())
    .filter(([key]) => key.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([configKey, row]) => ({ configKey, data: row.data, updatedAt: row.updatedAt, updatedBy: row.updatedBy }));
});

// Reversible stand-in for AES-GCM — same convention as config-service.test.ts.
let encryptionAvailable = true;
const mockEncrypt = vi.fn((plain: string) => `enc(${plain})`);
const mockDecrypt = vi.fn((cipher: string) => {
  const match = /^enc\((.*)\)$/.exec(cipher);
  if (!match) throw new Error('Invalid encrypted format');
  return match[1];
});

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    listByPrefix: mockListByPrefix,
  })),
  EncryptionService: vi.fn().mockImplementation(() => {
    if (!encryptionAvailable) throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    return { encrypt: mockEncrypt, decrypt: mockDecrypt };
  }),
}));

import { IntegrationConfigService, OAuthReauthRequiredError } from './account-config-service';
import { ConnectorEncryptionUnavailableError } from '../connectors/config-service';
import type { IntegrationDescriptor } from './types';

const singleDescriptor: IntegrationDescriptor = {
  name: 'github',
  displayName: 'GitHub',
  description: 'test',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['token'],
  verify: async () => ({ ok: true, detail: 'ok' }),
};

const multiDescriptor: IntegrationDescriptor = {
  name: 'hubspot',
  displayName: 'HubSpot',
  description: 'test',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['token'],
  verify: async () => ({ ok: true, detail: 'ok' }),
};

const mockRefresh = vi.fn();
const mockRevoke = vi.fn();

const oauthDescriptor: IntegrationDescriptor = {
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
    scopes: [],
    clientId: () => 'client-id',
    clientSecret: () => 'client-secret',
    exchangeCode: async () => ({ ok: false, error: 'not used in this test' }),
    identify: async () => ({ ok: false, error: 'not used in this test' }),
    refresh: mockRefresh,
    revoke: mockRevoke,
  },
};

describe('IntegrationConfigService', () => {
  beforeEach(() => {
    store.clear();
    clock = 0;
    encryptionAvailable = true;
    vi.clearAllMocks();
  });

  describe('single-account mode', () => {
    it('saves and resolves the sole "default" account', async () => {
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      await svc.saveAccount('default', { token: 'ghp-1234567890' }, 'user-1');

      const resolved = await svc.resolveAccount();
      expect(resolved).toEqual({ accountId: 'default', raw: { token: 'ghp-1234567890' } });

      const accounts = await svc.listAccounts();
      expect(accounts).toEqual([
        { accountId: 'default', label: 'default', isDefault: true, fields: { token: 'ghp-****7890' } },
      ]);
    });

    it('encrypts secret fields at rest', async () => {
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      await svc.saveAccount('default', { token: 'ghp-123' });
      const stored = store.get('claw-integration-github:account:default')!;
      expect(stored.data.token).toBe('enc(ghp-123)');
    });

    it('a blank field on update keeps the existing stored value', async () => {
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      await svc.saveAccount('default', { token: 'ghp-123' });
      await svc.saveAccount('default', { token: '' });

      const raw = await svc.getRawAccount('default');
      expect(raw?.token).toBe('ghp-123');
    });

    it('resolveAccount returns null when nothing is connected', async () => {
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      expect(await svc.resolveAccount()).toBeNull();
    });
  });

  describe('multi-account mode', () => {
    it('auto-promotes the first connected account to default', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });

      const accounts = await svc.listAccounts();
      expect(accounts).toEqual([{ accountId: 'hub-1', label: 'Portal 1', isDefault: true, fields: { token: '********' } }]);
    });

    it('a second account does not become default unless makeDefault is set', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });
      await svc.saveAccount('hub-2', { token: 'b' }, 'user-1', { label: 'Portal 2' });

      const accounts = await svc.listAccounts();
      const byId = Object.fromEntries(accounts.map((a) => [a.accountId, a]));
      expect(byId['hub-1'].isDefault).toBe(true);
      expect(byId['hub-2'].isDefault).toBe(false);
    });

    it('makeDefault flips which account is default', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });
      await svc.saveAccount('hub-2', { token: 'b' }, 'user-1', { label: 'Portal 2', makeDefault: true });

      const accounts = await svc.listAccounts();
      const byId = Object.fromEntries(accounts.map((a) => [a.accountId, a]));
      expect(byId['hub-1'].isDefault).toBe(false);
      expect(byId['hub-2'].isDefault).toBe(true);
    });

    it('resolveAccount finds by exact accountId, then by label', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal One' });

      expect((await svc.resolveAccount('hub-1'))?.accountId).toBe('hub-1');
      expect((await svc.resolveAccount('portal one'))?.accountId).toBe('hub-1');
    });

    it('resolveAccount falls back to the default pointer when no id/label given', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });
      await svc.saveAccount('hub-2', { token: 'b' }, 'user-1', { label: 'Portal 2' });

      expect((await svc.resolveAccount())?.accountId).toBe('hub-1');
    });

    it('removeAccount on the default promotes the earliest-updated remaining account', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });
      await svc.saveAccount('hub-2', { token: 'b' }, 'user-1', { label: 'Portal 2' });

      await svc.removeAccount('hub-1');

      const accounts = await svc.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].accountId).toBe('hub-2');
      expect(accounts[0].isDefault).toBe(true);
    });

    it('removeAccount on the only account clears the default pointer entirely', async () => {
      const svc = new IntegrationConfigService('tenant-1', multiDescriptor);
      await svc.saveAccount('hub-1', { token: 'a' }, 'user-1', { label: 'Portal 1' });
      await svc.removeAccount('hub-1');

      expect(await svc.listAccounts()).toEqual([]);
      expect(store.has('claw-integration-hubspot:default')).toBe(false);
      expect(await svc.resolveAccount()).toBeNull();
    });
  });

  describe('encryption unavailable', () => {
    it('saveAccount throws ConnectorEncryptionUnavailableError when ENCRYPTION_KEY is unset', async () => {
      encryptionAvailable = false;
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      await expect(svc.saveAccount('default', { token: 'x' })).rejects.toBeInstanceOf(ConnectorEncryptionUnavailableError);
    });

    it('listAccounts still works without decrypting (no secrets to show) when nothing is stored', async () => {
      encryptionAvailable = false;
      const svc = new IntegrationConfigService('tenant-1', singleDescriptor);
      expect(await svc.listAccounts()).toEqual([]);
    });
  });

  describe('OAuth token refresh', () => {
    beforeEach(() => {
      mockRefresh.mockReset();
      mockRevoke.mockReset();
    });

    it('does not refresh a token that is not near expiry', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await svc.saveAccount('acct-1', { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: farFuture });

      const resolved = await svc.resolveAccount();
      expect(resolved?.raw.accessToken).toBe('access-1');
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('refreshes a token within the buffer window and persists the result', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const almostExpired = new Date(Date.now() + 30_000).toISOString(); // < 2min buffer
      await svc.saveAccount('acct-1', { accessToken: 'stale-access', refreshToken: 'refresh-1', expiresAt: almostExpired });

      const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockRefresh.mockResolvedValue({ ok: true, tokens: { accessToken: 'fresh-access', expiresAt: newExpiry } });

      const resolved = await svc.resolveAccount();
      expect(mockRefresh).toHaveBeenCalledWith('refresh-1');
      expect(resolved?.raw.accessToken).toBe('fresh-access');

      // Persisted — a second resolve doesn't refresh again since it's no longer near expiry.
      mockRefresh.mockClear();
      const second = await svc.resolveAccount();
      expect(second?.raw.accessToken).toBe('fresh-access');
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('keeps the old refresh token when the provider does not rotate it', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const almostExpired = new Date(Date.now() + 30_000).toISOString();
      await svc.saveAccount('acct-1', { accessToken: 'stale', refreshToken: 'refresh-original', expiresAt: almostExpired });
      mockRefresh.mockResolvedValue({ ok: true, tokens: { accessToken: 'fresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() } });

      const resolved = await svc.resolveAccount();
      expect(resolved?.raw.refreshToken).toBe('refresh-original');
    });

    it('coalesces concurrent resolves for the same account onto one refresh call', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const almostExpired = new Date(Date.now() + 30_000).toISOString();
      await svc.saveAccount('acct-1', { accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: almostExpired });

      let resolveRefresh!: (v: unknown) => void;
      mockRefresh.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

      const [p1, p2] = [svc.resolveAccount(), svc.resolveAccount()];
      resolveRefresh({ ok: true, tokens: { accessToken: 'fresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() } });
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(r1?.raw.accessToken).toBe('fresh');
      expect(r2?.raw.accessToken).toBe('fresh');
    });

    it('throws OAuthReauthRequiredError on a rejected refresh and leaves the stored row untouched', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const almostExpired = new Date(Date.now() + 30_000).toISOString();
      await svc.saveAccount('acct-1', { accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: almostExpired });
      mockRefresh.mockResolvedValue({ ok: false, error: 'invalid_grant' });

      await expect(svc.resolveAccount()).rejects.toBeInstanceOf(OAuthReauthRequiredError);

      // The row is untouched — a later successful refresh attempt can still use it.
      const stillThere = await svc.getRawAccount('acct-1');
      expect(stillThere?.refreshToken).toBe('refresh-1');
    });

    it('does not attempt to refresh when there is no refresh token stored', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      const almostExpired = new Date(Date.now() + 30_000).toISOString();
      await svc.saveAccount('acct-1', { accessToken: 'stale', expiresAt: almostExpired });

      const resolved = await svc.resolveAccount();
      expect(resolved?.raw.accessToken).toBe('stale');
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe('OAuth provider-side revoke', () => {
    beforeEach(() => {
      mockRefresh.mockReset();
      mockRevoke.mockReset();
    });

    it('removeAccount calls revoke with the decrypted account before deleting', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      await svc.saveAccount('acct-1', { accessToken: 'access-1', refreshToken: 'refresh-1' });
      mockRevoke.mockResolvedValue(undefined);

      await svc.removeAccount('acct-1');

      expect(mockRevoke).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access-1' }));
      expect(await svc.getRawAccount('acct-1')).toBeNull();
    });

    it('still removes the account locally when the provider revoke call throws', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      await svc.saveAccount('acct-1', { accessToken: 'access-1' });
      mockRevoke.mockRejectedValue(new Error('provider unreachable'));

      await svc.removeAccount('acct-1');

      expect(await svc.getRawAccount('acct-1')).toBeNull();
    });

    it('disconnectAll revokes every account before wiping them', async () => {
      const svc = new IntegrationConfigService('tenant-1', oauthDescriptor);
      await svc.saveAccount('acct-1', { accessToken: 'a1' });
      await svc.saveAccount('acct-2', { accessToken: 'a2' });
      mockRevoke.mockResolvedValue(undefined);

      await svc.disconnectAll();

      expect(mockRevoke).toHaveBeenCalledTimes(2);
      expect(await svc.listAccounts()).toEqual([]);
    });
  });
});
