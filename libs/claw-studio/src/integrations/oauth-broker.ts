/**
 * oauth-broker.ts — the provider-agnostic half of the OAuth redirect flow.
 * The two Next.js routes (`oauth/start`, `oauth/callback`) stay thin wrappers
 * around `buildAuthorizeUrl`/`completeOAuthCallback` so this logic is
 * unit-testable without a running server, the same way `github.ts`'s tool
 * bodies are tested without one.
 */

import { createLogger } from '@chatbot/shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor, VerifyResult } from './types';
import type { OAuthProviderConfig } from './oauth-types';

const logger = createLogger('claw-studio:integrations:oauth-broker');

/**
 * Every oauth-mode descriptor's `verify(fields)` is this one-liner — "Test
 * Connection" on an already-connected account has no form fields to check,
 * just the stored access token, so it delegates to `identify()` and adapts
 * the result into the shape every other integration's `verify()` returns.
 */
export function verifyViaIdentify(oauth: OAuthProviderConfig): (fields: Record<string, string>) => Promise<VerifyResult> {
  return async (fields) => {
    const accessToken = fields.accessToken;
    if (!accessToken) return { ok: false, error: 'No access token on this account — reconnect it.' };
    const result = await oauth.identify(accessToken);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, detail: `Connected to ${result.label}`, meta: { accountId: result.accountId, label: result.label } };
  };
}

export function buildAuthorizeUrl(descriptor: IntegrationDescriptor, redirectUri: string, state: string): string {
  const oauth = descriptor.oauth;
  if (!oauth) throw new Error(`${descriptor.name} is not an OAuth integration`);

  const params = new URLSearchParams({
    client_id: oauth.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    ...(oauth.scopes.length > 0 ? { scope: oauth.scopes.join(' ') } : {}),
    ...(oauth.extraAuthorizeParams ?? {}),
  });
  return `${oauth.authorizeUrl}?${params.toString()}`;
}

export interface OAuthCallbackResult {
  ok: boolean;
  accountId?: string;
  label?: string;
  error?: string;
}

export async function completeOAuthCallback(
  descriptor: IntegrationDescriptor,
  tenantId: string,
  actor: string,
  code: string,
  redirectUri: string,
): Promise<OAuthCallbackResult> {
  const oauth = descriptor.oauth;
  if (!oauth) return { ok: false, error: `${descriptor.name} is not an OAuth integration` };

  const exchanged = await oauth.exchangeCode(code, redirectUri);
  if (!exchanged.ok) {
    logger.warn({ tenantId, integration: descriptor.name, error: exchanged.error }, 'OAuth code exchange failed');
    return { ok: false, error: exchanged.error };
  }

  let identity = exchanged.identity;
  if (!identity) {
    const identified = await oauth.identify(exchanged.tokens.accessToken);
    if (!identified.ok) {
      logger.warn({ tenantId, integration: descriptor.name, error: identified.error }, 'OAuth identify failed');
      return { ok: false, error: identified.error };
    }
    identity = { accountId: identified.accountId, label: identified.label };
  }

  const fields: Record<string, string> = { accessToken: exchanged.tokens.accessToken };
  if (exchanged.tokens.refreshToken) fields.refreshToken = exchanged.tokens.refreshToken;
  if (exchanged.tokens.expiresAt) fields.expiresAt = exchanged.tokens.expiresAt;
  if (exchanged.tokens.scope) fields.scope = exchanged.tokens.scope;

  const configs = new IntegrationConfigService(tenantId, descriptor);
  await configs.saveAccount(identity.accountId, fields, actor, { label: identity.label });

  logger.info({ tenantId, integration: descriptor.name, accountId: identity.accountId }, 'OAuth account connected');
  return { ok: true, accountId: identity.accountId, label: identity.label };
}
