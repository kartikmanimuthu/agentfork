import { describe, it, expect, vi, beforeEach } from 'vitest';

let stateSecret: string | undefined = 'a'.repeat(32);

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  get env() {
    return { OAUTH_STATE_SECRET: stateSecret };
  },
}));

import { signOAuthState, verifyOAuthState, OAuthStateSecretUnavailableError } from './oauth-state';

describe('OAuth state sign/verify', () => {
  beforeEach(() => {
    stateSecret = 'a'.repeat(32);
  });

  it('round-trips a freshly signed state', () => {
    const state = signOAuthState('notion');
    expect(verifyOAuthState('notion', state)).toBe(true);
  });

  it('rejects a state signed for a different integration', () => {
    const state = signOAuthState('notion');
    expect(verifyOAuthState('gmail', state)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const state = signOAuthState('notion');
    const [payload, signature] = state.split('.');
    const tampered = `${payload}.${signature.slice(0, -2)}xx`;
    expect(verifyOAuthState('notion', tampered)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const state = signOAuthState('notion');
    const [, signature] = state.split('.');
    const forgedPayload = Buffer.from('notion:forged-nonce:9999999999999').toString('base64url');
    expect(verifyOAuthState('notion', `${forgedPayload}.${signature}`)).toBe(false);
  });

  it('rejects a malformed state string', () => {
    expect(verifyOAuthState('notion', 'not-a-real-state')).toBe(false);
    expect(verifyOAuthState('notion', '')).toBe(false);
  });

  it('rejects an expired state', () => {
    vi.useFakeTimers();
    try {
      const state = signOAuthState('notion');
      vi.advanceTimersByTime(11 * 60 * 1000); // past the 10 minute TTL
      expect(verifyOAuthState('notion', state)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('produces a different nonce (and state string) on every call', () => {
    const a = signOAuthState('notion');
    const b = signOAuthState('notion');
    expect(a).not.toBe(b);
  });

  it('throws OAuthStateSecretUnavailableError when OAUTH_STATE_SECRET is unset', () => {
    stateSecret = undefined;
    expect(() => signOAuthState('notion')).toThrow(OAuthStateSecretUnavailableError);
  });

  it('verify returns false (not throw) when OAUTH_STATE_SECRET is unset', () => {
    const state = signOAuthState('notion');
    stateSecret = undefined;
    expect(verifyOAuthState('notion', state)).toBe(false);
  });
});
