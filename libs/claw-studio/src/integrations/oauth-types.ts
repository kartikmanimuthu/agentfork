/**
 * oauth-types.ts — the provider-agnostic OAuth contract an `IntegrationDescriptor`
 * plugs into via its optional `oauth` field (see `types.ts`). One shape covers
 * Google (Gmail/Calendar/Drive — refreshable), Microsoft (Outlook — refreshable),
 * and Notion (tokens don't expire, no refresh/revoke) uniformly; a provider that
 * doesn't need `refresh`/`revoke` simply omits them.
 */

export interface OAuthTokenSet {
  accessToken: string;
  /** Absent only for providers whose tokens don't expire (Notion). */
  refreshToken?: string;
  /** ISO 8601. Absent only for providers whose tokens don't expire (Notion). */
  expiresAt?: string;
  scope?: string;
}

export type OAuthIdentity = { accountId: string; label: string };

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Reads the provider's client id from env — throws a clear error if unset. */
  clientId(): string;
  /** Reads the provider's client secret from env — throws a clear error if unset. */
  clientSecret(): string;
  /** e.g. Google's `access_type=offline&prompt=consent`, required to actually receive a refresh token. */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * Code → tokens. `identity` is populated inline only when the token
   * response itself carries it (Notion); otherwise the caller falls back to
   * `identify()` with the fresh access token.
   */
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ ok: true; tokens: OAuthTokenSet; identity?: OAuthIdentity } | { ok: false; error: string }>;
  /**
   * "Who does this access token belong to" — used by the callback (when
   * exchangeCode didn't return identity) AND by `verify()` (Test Connection
   * on an already-connected account).
   */
  identify(accessToken: string): Promise<({ ok: true } & OAuthIdentity) | { ok: false; error: string }>;
  /** Absent for providers whose tokens don't expire (Notion). */
  refresh?(refreshToken: string): Promise<{ ok: true; tokens: OAuthTokenSet } | { ok: false; error: string }>;
  /** Best-effort provider-side revoke, called (and swallowed on failure) on disconnect. Absent where no such endpoint exists. */
  revoke?(raw: Record<string, unknown>): Promise<void>;
}
