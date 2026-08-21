import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  env: { MICROSOFT_OAUTH_CLIENT_ID: 'client-id', MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret' },
}));

import { createMicrosoftOAuthProvider } from './microsoft';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('createMicrosoftOAuthProvider', () => {
  beforeEach(() => fetchMock.mockReset());

  it('always includes offline_access even if the caller forgot it', () => {
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);
    expect(provider.scopes).toEqual(['offline_access', 'Mail.Read']);
  });

  it('does not duplicate offline_access if the caller already included it', () => {
    const provider = createMicrosoftOAuthProvider(['offline_access', 'Mail.Read']);
    expect(provider.scopes).toEqual(['offline_access', 'Mail.Read']);
  });

  it('exchangeCode returns tokens without inline identity (needs a follow-up Graph /me call)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);
    const result = await provider.exchangeCode('code-1', 'https://mc.example.com/cb');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.refreshToken).toBe('r1');
      expect(result.identity).toBeUndefined();
    }
  });

  it('identify prefers `mail` and falls back to `userPrincipalName`', async () => {
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);

    fetchMock.mockResolvedValueOnce(jsonResponse({ mail: 'me@work.com', userPrincipalName: 'me@work.onmicrosoft.com' }));
    expect(await provider.identify('a1')).toEqual({ ok: true, accountId: 'me@work.com', label: 'me@work.com' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ userPrincipalName: 'me@work.onmicrosoft.com' }));
    expect(await provider.identify('a1')).toEqual({
      ok: true,
      accountId: 'me@work.onmicrosoft.com',
      label: 'me@work.onmicrosoft.com',
    });
  });

  it('refresh returns the rotated refresh token — Microsoft rotates it on every use, unlike Google', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }));
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);
    const result = await provider.refresh!('r1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens.refreshToken).toBe('r2');
  });

  it('refresh surfaces a rejected grant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, false, 400));
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);
    const result = await provider.refresh!('revoked');
    expect(result.ok).toBe(false);
  });

  it('has no revoke — no reliable unilateral revoke endpoint for this app type', () => {
    const provider = createMicrosoftOAuthProvider(['Mail.Read']);
    expect(provider.revoke).toBeUndefined();
  });
});
