/**
 * oauth-providers/microsoft.ts — Microsoft identity platform v2.0
 * (login.microsoftonline.com), used by Outlook (Microsoft Graph).
 *
 * A factory like Google's, though only one connector (Outlook) currently
 * uses it — kept as a factory anyway so a future second Microsoft Graph
 * connector (e.g. Teams) could share the app without duplicating this file.
 *
 * No `revoke`: unlike Google, there is no reliably documented endpoint for a
 * confidential/server-side app to unilaterally revoke a specific refresh
 * token it holds — disconnect only ever deletes the local copy here.
 */

import { env, createLogger } from '@chatbot/shared';
import type { OAuthProviderConfig } from '../oauth-types';

const logger = createLogger('claw-studio:integrations:oauth:microsoft');

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';
/**
 * Bounds every call — this matters even more here than in a plain tool file:
 * `refresh()` runs inside `IntegrationConfigService.resolveAccount()`, so a
 * stalled call here hangs every Outlook tool call, not just one.
 */
const REQUEST_TIMEOUT_MS = 15_000;

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function clientId(): string {
  if (!env.MICROSOFT_OAUTH_CLIENT_ID) throw new Error('MICROSOFT_OAUTH_CLIENT_ID is not configured.');
  return env.MICROSOFT_OAUTH_CLIENT_ID;
}

function clientSecret(): string {
  if (!env.MICROSOFT_OAUTH_CLIENT_SECRET) throw new Error('MICROSOFT_OAUTH_CLIENT_SECRET is not configured.');
  return env.MICROSOFT_OAUTH_CLIENT_SECRET;
}

function expiresAtFrom(expiresIn: number | undefined): string | undefined {
  return typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
}

export function createMicrosoftOAuthProvider(scopes: string[]): OAuthProviderConfig {
  // offline_access is what gets a refresh_token back at all — required
  // regardless of what the caller passed, so it's added here rather than
  // relying on every connector to remember it.
  const fullScopes = scopes.includes('offline_access') ? scopes : ['offline_access', ...scopes];

  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: fullScopes,
    clientId,
    clientSecret,
    extraAuthorizeParams: { response_mode: 'query' },

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
            scope: fullScopes.join(' '),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = (await res.json()) as MicrosoftTokenResponse;
        if (!res.ok || !data.access_token) {
          logger.warn({ status: res.status, error: data.error }, 'Microsoft token exchange rejected');
          return { ok: false, error: `Microsoft token exchange failed: ${data.error_description ?? data.error ?? res.status}` };
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
        logger.error({ error }, 'Microsoft token exchange threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Microsoft token exchange failed' };
      }
    },

    async identify(accessToken) {
      try {
        const res = await fetch(GRAPH_ME_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ok: false, error: `Microsoft Graph rejected the token (${res.status}): ${text.slice(0, 200)}` };
        }
        const data = JSON.parse(text) as { mail?: string; userPrincipalName?: string };
        const email = data.mail || data.userPrincipalName;
        if (!email) return { ok: false, error: 'Microsoft Graph did not return an account email.' };
        return { ok: true, accountId: email, label: email };
      } catch (error) {
        logger.error({ error }, 'Microsoft identify threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Microsoft identify failed' };
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
            scope: fullScopes.join(' '),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = (await res.json()) as MicrosoftTokenResponse;
        if (!res.ok || !data.access_token) {
          logger.warn({ status: res.status, error: data.error }, 'Microsoft token refresh rejected');
          return { ok: false, error: data.error_description ?? data.error ?? `Microsoft refresh failed (${res.status})` };
        }
        // Microsoft rotates the refresh token on every use — the new one MUST
        // be persisted, unlike Google which normally keeps the original.
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
        logger.error({ error }, 'Microsoft token refresh threw');
        return { ok: false, error: error instanceof Error ? error.message : 'Microsoft token refresh failed' };
      }
    },
    // No `revoke` — see file header.
  };
}
