/**
 * oauth-providers/google.ts — Google's OAuth2 (accounts.google.com), shared by
 * Gmail, Google Calendar, and Google Drive.
 *
 * A factory, not a fixed provider object: one Google Cloud OAuth app (one
 * `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` pair) backs all three connectors, but each
 * requests its own scope and completes its own consent screen and stores its
 * own account rows — mirroring the OpenWorker reference project's own data
 * model, which keeps gmail/google_calendar/google_drive as fully separate
 * connectors despite sharing one Google app. `createGoogleOAuthProvider(scopes)`
 * is called once per connector with that connector's own scope list.
 */

import { env, createLogger } from '@chatbot/shared';
import type { OAuthProviderConfig } from '../oauth-types';

const logger = createLogger('claw-studio:integrations:oauth:google');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/**
 * Bounds every call — this matters even more here than in a plain tool file:
 * `refresh()` runs inside `IntegrationConfigService.resolveAccount()`, so a
 * stalled call here hangs every Gmail/Calendar/Drive tool call, not just one.
 */
const REQUEST_TIMEOUT_MS = 15_000;

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function clientId(): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured.');
  return env.GOOGLE_OAUTH_CLIENT_ID;
}

function clientSecret(): string {
  if (!env.GOOGLE_OAUTH_CLIENT_SECRET) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not configured.');
  return env.GOOGLE_OAUTH_CLIENT_SECRET;
}

function expiresAtFrom(expiresIn: number | undefined): string | undefined {
  return typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
}

const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export function createGoogleOAuthProvider(scopes: string[]): OAuthProviderConfig {
  // identify() below calls Google's userinfo endpoint to resolve which account
  // this token belongs to — that endpoint needs its own scope regardless of
  // what the connector itself requests, or Google rejects it with a 401
  // ("missing required authentication credential") even though the token
  // exchange itself succeeded.
  const fullScopes = scopes.includes(USERINFO_EMAIL_SCOPE) ? scopes : [...scopes, USERINFO_EMAIL_SCOPE];

  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: fullScopes,
    clientId,
    clientSecret,
    // Google only returns a refresh_token on the FIRST consent unless
    // prompt=consent forces it every time — without this, reconnecting after
    // a revoke would silently get no refresh token and break at next expiry.
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },

    async exchangeCode(code, redirectUri) {
      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId(),
            client_secret: clientSecret(),
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = (await res.json()) as GoogleTokenResponse;
        if (!res.ok || !data.access_token) {
          logger.warn({ status: res.status, error: data.error }, 'Google token exchange rejected');
          return { ok: false, error: `Google token exchange failed: ${data.error_description ?? data.error ?? res.status}` };
        }
        return {
          ok: true,
          tokens: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: expiresAtFrom(data.expires_in),
            scope: data.scope,
          },
        };
      } catch (error) {
        logger.error({ error }, 'Google token exchange threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Google token exchange failed' };
      }
    },

    async identify(accessToken) {
      try {
        const res = await fetch(USERINFO_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ok: false, error: `Google rejected the token (${res.status}): ${text.slice(0, 200)}` };
        }
        const data = JSON.parse(text) as { email?: string };
        if (!data.email) return { ok: false, error: 'Google did not return an account email.' };
        return { ok: true, accountId: data.email, label: data.email };
      } catch (error) {
        logger.error({ error }, 'Google identify threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Google identify failed' };
      }
    },

    async refresh(refreshToken) {
      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId(),
            client_secret: clientSecret(),
            grant_type: 'refresh_token',
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = (await res.json()) as GoogleTokenResponse;
        if (!res.ok || !data.access_token) {
          logger.warn({ status: res.status, error: data.error }, 'Google token refresh rejected');
          return { ok: false, error: data.error_description ?? data.error ?? `Google refresh failed (${res.status})` };
        }
        // Google generally doesn't re-issue a refresh_token on refresh — the
        // original one (from exchangeCode) keeps working until revoked.
        return { ok: true, tokens: { accessToken: data.access_token, expiresAt: expiresAtFrom(data.expires_in), scope: data.scope } };
      } catch (error) {
        logger.error({ error }, 'Google token refresh threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Google token refresh failed' };
      }
    },

    async revoke(raw) {
      const token = (raw.refreshToken as string | undefined) || (raw.accessToken as string | undefined);
      if (!token) return;
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    },
  };
}
