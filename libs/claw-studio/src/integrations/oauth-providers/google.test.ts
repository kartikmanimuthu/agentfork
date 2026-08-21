import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  env: { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' },
}));

import { createGoogleOAuthProvider } from './google';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('createGoogleOAuthProvider', () => {
  beforeEach(() => fetchMock.mockReset());

  it('always requests offline access + forced consent so a refresh token is guaranteed on every connect', () => {
    const provider = createGoogleOAuthProvider(['scope-a']);
    expect(provider.extraAuthorizeParams).toEqual({ access_type: 'offline', prompt: 'consent' });
    expect(provider.scopes).toEqual(['scope-a', 'https://www.googleapis.com/auth/userinfo.email']);
  });

  it('does not duplicate the userinfo.email scope if a connector already requests it', () => {
    const provider = createGoogleOAuthProvider(['https://www.googleapis.com/auth/userinfo.email']);
    expect(provider.scopes).toEqual(['https://www.googleapis.com/auth/userinfo.email']);
  });

  it('exchangeCode returns tokens without inline identity (Google needs a follow-up userinfo call)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
    const provider = createGoogleOAuthProvider(['scope-a']);
    const result = await provider.exchangeCode('code-1', 'https://mc.example.com/cb');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('a1');
      expect(result.tokens.refreshToken).toBe('r1');
      expect(result.identity).toBeUndefined();
    }
  });

  it('exchangeCode surfaces the provider error on rejection', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant', error_description: 'Bad code' }, false, 400));
    const provider = createGoogleOAuthProvider(['scope-a']);
    const result = await provider.exchangeCode('bad-code', 'https://mc.example.com/cb');
    expect(result.ok).toBe(false);
  });

  it('identify surfaces the account email', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: 'me@gmail.com' }));
    const provider = createGoogleOAuthProvider(['scope-a']);
    const result = await provider.identify('a1');
    expect(result).toEqual({ ok: true, accountId: 'me@gmail.com', label: 'me@gmail.com' });
  });

  it('refresh preserves scope handling and does not require a new refresh token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'a2', expires_in: 3600 }));
    const provider = createGoogleOAuthProvider(['scope-a']);
    const result = await provider.refresh!('r1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('a2');
      expect(result.tokens.refreshToken).toBeUndefined();
    }
  });

  it('refresh surfaces invalid_grant so the caller can require reauth', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, false, 400));
    const provider = createGoogleOAuthProvider(['scope-a']);
    const result = await provider.refresh!('revoked-token');
    expect(result.ok).toBe(false);
  });

  it('revoke calls the Google revoke endpoint with the refresh token when present', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const provider = createGoogleOAuthProvider(['scope-a']);
    await provider.revoke!({ accessToken: 'a1', refreshToken: 'r1' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('token=r1'), expect.objectContaining({ method: 'POST' }));
  });

  it('revoke falls back to the access token when no refresh token is stored', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const provider = createGoogleOAuthProvider(['scope-a']);
    await provider.revoke!({ accessToken: 'a1' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('token=a1'), expect.anything());
  });
});
