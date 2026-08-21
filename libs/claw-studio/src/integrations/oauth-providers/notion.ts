/**
 * oauth-providers/notion.ts — Notion's OAuth2 (https://developers.notion.com/docs/authorization).
 *
 * No refresh flow and no expiry: Notion's public-integration access tokens
 * don't expire, so `refresh`/`revoke` are both absent — `expiresAt` is simply
 * never stored for this connector, which is what keeps
 * `IntegrationConfigService.resolveAccount()`'s refresh logic a no-op here.
 * No `scope` concept either — access is determined by which pages/databases
 * the user shares with the integration during the consent screen itself, not
 * by requested OAuth scopes, so `scopes: []` and no `scope` query param.
 */

import { env, createLogger } from '@chatbot/shared';
import type { OAuthProviderConfig } from '../oauth-types';

const logger = createLogger('claw-studio:integrations:oauth:notion');

const NOTION_VERSION = '2022-06-28';
/** Bounds every call — without this, a stalled Notion API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function clientId(): string {
  if (!env.NOTION_OAUTH_CLIENT_ID) throw new Error('NOTION_OAUTH_CLIENT_ID is not configured.');
  return env.NOTION_OAUTH_CLIENT_ID;
}

function clientSecret(): string {
  if (!env.NOTION_OAUTH_CLIENT_SECRET) throw new Error('NOTION_OAUTH_CLIENT_SECRET is not configured.');
  return env.NOTION_OAUTH_CLIENT_SECRET;
}

export const notionOAuthProvider: OAuthProviderConfig = {
  authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
  tokenUrl: 'https://api.notion.com/v1/oauth/token',
  scopes: [],
  clientId,
  clientSecret,
  extraAuthorizeParams: { owner: 'user', response_type: 'code' },

  async exchangeCode(code, redirectUri) {
    try {
      const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
      const res = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Notion token exchange rejected');
        return { ok: false, error: `Notion token exchange failed (${res.status}): ${text.slice(0, 300)}` };
      }
      const data = JSON.parse(text) as { access_token?: string; workspace_id?: string; workspace_name?: string };
      if (!data.access_token || !data.workspace_id) {
        return { ok: false, error: 'Notion did not return an access token and workspace id.' };
      }
      return {
        ok: true,
        tokens: { accessToken: data.access_token },
        identity: { accountId: `notion-${data.workspace_id}`, label: data.workspace_name || `Workspace ${data.workspace_id}` },
      };
    } catch (error) {
      logger.error({ error }, 'Notion token exchange threw');
      return { ok: false, error: error instanceof Error ? error.message : 'Notion token exchange failed' };
    }
  },

  async identify(accessToken) {
    try {
      const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': NOTION_VERSION },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Notion identify rejected');
        return { ok: false, error: `Notion rejected the token (${res.status}): ${text.slice(0, 200)}` };
      }
      const data = JSON.parse(text) as { id?: string; bot?: { workspace_name?: string } };
      const workspaceName = data.bot?.workspace_name;
      return { ok: true, accountId: `notion-${data.id ?? 'unknown'}`, label: workspaceName || 'Notion workspace' };
    } catch (error) {
      logger.error({ error }, 'Notion identify threw');
      return { ok: false, error: error instanceof Error ? error.message : 'Notion identify failed' };
    }
  },
  // No `refresh` (tokens don't expire) and no `revoke` (Notion has no revoke endpoint) —
  // disconnect only ever deletes the local copy for this connector.
};
