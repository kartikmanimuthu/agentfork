/**
 * types.ts — the tool-only integration connector contract.
 *
 * Distinct from `../connectors/types.ts` (`ChannelConnector`/`ChannelAdapter`),
 * which models inbound/outbound messaging platforms (Slack, Telegram). An
 * `IntegrationDescriptor` has no inbound side at all — it's just enough data
 * to validate a credential and know which fields are secret. Everything else
 * (what tools it exposes) lives in the integration's own module (`github.ts`,
 * `hubspot.ts`, `email.ts`), not on the descriptor itself.
 */

import type { VerifyResult, VerifySuccess, VerifyFailure } from '../connectors/types';
import type { OAuthProviderConfig } from './oauth-types';

export type { VerifyResult, VerifySuccess, VerifyFailure };
export type { OAuthProviderConfig, OAuthTokenSet, OAuthIdentity } from './oauth-types';

/**
 * 'single' — exactly one connected account, always stored under the literal
 * accountId `'default'` (GitHub, generic email).
 * 'multi' — zero or more connected accounts, one marked default (HubSpot,
 * OAuth-based connectors). The accountId is derived from `verify()`'s result,
 * never client-supplied.
 */
export type AccountMode = 'single' | 'multi';

/**
 * 'manual' — the user pastes a credential (token, API key, app password)
 * through a form, validated by `verify()`.
 * 'oauth' — the user clicks through the provider's own consent screen; `oauth`
 * is required in this mode and `verify()` delegates to `oauth.identify()`.
 */
export type AuthMode = 'manual' | 'oauth';

export interface IntegrationDescriptor {
  /** Stable slug — used in storage keys, tool name prefixes, and API routes. */
  name: string;
  displayName: string;
  description: string;
  accountMode: AccountMode;
  authMode: AuthMode;
  /** Field names whose values are encrypted at rest and masked on read. */
  secretFields: readonly string[];
  /**
   * Validates a candidate credential set against the real service — no
   * tenantId, no DB access, a pure function of the fields given. For
   * `accountMode: 'multi'`, a successful result's `meta.accountId` and
   * `meta.label` are what the caller derives the storage key and display
   * label from; the descriptor itself never touches storage. For
   * `authMode: 'oauth'`, this delegates to `oauth.identify(fields.accessToken)`
   * — used by "Test Connection" on an already-connected account, since there's
   * no manual form to validate against.
   */
  verify(fields: Record<string, string>): Promise<VerifyResult>;
  /** Present iff `authMode === 'oauth'`. */
  oauth?: OAuthProviderConfig;
}
