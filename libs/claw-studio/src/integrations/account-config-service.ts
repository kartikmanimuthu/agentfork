/**
 * account-config-service.ts — per-tenant, per-account storage for tool-only
 * integration connectors (GitHub, HubSpot, generic email — see types.ts).
 *
 * One implementation serves both single- and multi-account integrations: a
 * single-account integration is just "multi-account with exactly one row,
 * always keyed `'default'`" — matching the convergence OpenWorker's own
 * accounts.py made (their docstring: newer connectors all share one generic
 * multi-account layer instead of a bespoke module per connector) rather than
 * maintaining two parallel storage implementations.
 *
 * Reuses `../connectors/config-service.ts`'s encryption/error primitives
 * verbatim rather than forking them — same `EncryptionService`, same
 * `ConnectorEncryptionUnavailableError` (so every route's 503 handling for
 * "ENCRYPTION_KEY not set" already works for integrations with no new code),
 * same `maskSecret` masking rule.
 */

import { TenantConfigService, EncryptionService, createLogger } from '@chatbot/shared';
import { maskSecret } from '../connectors/mask';
import { ConnectorEncryptionUnavailableError } from '../connectors/config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integration-config');

export interface IntegrationAccountSummary {
  accountId: string;
  /** Non-secret, human-readable — a portal id, an email address, or a fixed label for single-account integrations. */
  label: string;
  isDefault: boolean;
  /** Secret fields are masked; non-secret fields are verbatim. Absent fields are omitted. */
  fields: Record<string, string>;
}

interface RawAccountRow {
  accountId: string;
  data: Record<string, unknown>;
  updatedAt: Date;
}

function safeDecrypt(enc: EncryptionService, value: string, context: string): string | null {
  try {
    return enc.decrypt(value);
  } catch (error) {
    logger.error({ error, context }, 'Failed to decrypt integration secret — treating as unset');
    return null;
  }
}

/**
 * Thrown by `resolveAccount()` when an OAuth token needed refreshing and the
 * provider rejected the refresh (e.g. `invalid_grant` — the grant was revoked
 * externally). The stored account row is left untouched: reconnecting via
 * OAuth overwrites the same accountId through `saveAccount()`'s existing
 * upsert semantics, so nothing is lost by not deleting it here.
 */
export class OAuthReauthRequiredError extends Error {
  constructor(displayName: string) {
    super(`This ${displayName} connection has expired or was revoked — reconnect it in Mission Control → Integrations.`);
    this.name = 'OAuthReauthRequiredError';
  }
}

/** Refresh 2 minutes before actual expiry, so a tool call never races the provider's own clock. */
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

export class IntegrationConfigService {
  private readonly configs: TenantConfigService;
  private readonly tenantId: string;
  private readonly descriptor: IntegrationDescriptor;
  /**
   * Coalesces concurrent `resolveAccount()` calls for the same account onto one
   * in-flight refresh — LangGraph's `ToolNode` runs multiple tool calls from one
   * AI turn concurrently, and every tool in a factory call (e.g. all of
   * `createGmailTools()`) shares one `IntegrationConfigService` instance, so
   * this closes the common race without needing a distributed lock.
   */
  private readonly refreshInFlight = new Map<string, Promise<Record<string, unknown>>>();

  constructor(tenantId: string, descriptor: IntegrationDescriptor) {
    this.tenantId = tenantId;
    this.descriptor = descriptor;
    this.configs = new TenantConfigService(tenantId);
  }

  /** Constructed lazily so listing accounts (no decryption needed) doesn't fail with no ENCRYPTION_KEY set. */
  private encryption(): EncryptionService {
    try {
      return new EncryptionService();
    } catch {
      throw new ConnectorEncryptionUnavailableError();
    }
  }

  private accountPrefix(): string {
    return `claw-integration-${this.descriptor.name}:account:`;
  }

  private accountKey(accountId: string): string {
    return `${this.accountPrefix()}${accountId}`;
  }

  private defaultKey(): string {
    return `claw-integration-${this.descriptor.name}:default`;
  }

  private async getDefaultAccountId(): Promise<string | null> {
    const pointer = await this.configs.get<{ accountId: string }>(this.defaultKey());
    return pointer?.accountId ?? null;
  }

  private async setDefaultAccountId(accountId: string, updatedBy: string): Promise<void> {
    await this.configs.set(this.defaultKey(), { accountId }, updatedBy);
  }

  private async listRawAccountRows(): Promise<RawAccountRow[]> {
    const prefix = this.accountPrefix();
    const rows = await this.configs.listByPrefix<Record<string, unknown>>(prefix);
    return rows.map((row) => ({
      accountId: row.configKey.slice(prefix.length),
      data: row.data,
      updatedAt: row.updatedAt,
    }));
  }

  private toMaskedSummary(row: RawAccountRow, defaultId: string | null, enc: { current: EncryptionService | null }): IntegrationAccountSummary {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.data)) {
      if (key === 'label') continue;
      if (typeof value !== 'string' || !value) continue;
      if (this.descriptor.secretFields.includes(key)) {
        enc.current ??= this.encryption();
        const plain = safeDecrypt(enc.current, value, `${this.descriptor.name}.${row.accountId}.${key}`);
        if (plain) fields[key] = maskSecret(plain);
      } else {
        fields[key] = value;
      }
    }
    const label = typeof row.data.label === 'string' && row.data.label ? row.data.label : row.accountId;
    return { accountId: row.accountId, label, isDefault: row.accountId === defaultId, fields };
  }

  async listAccounts(): Promise<IntegrationAccountSummary[]> {
    const [rows, defaultId] = await Promise.all([this.listRawAccountRows(), this.getDefaultAccountId()]);
    const enc: { current: EncryptionService | null } = { current: null };
    return rows.map((row) => this.toMaskedSummary(row, defaultId, enc));
  }

  async getMaskedAccount(accountId: string): Promise<IntegrationAccountSummary | null> {
    const stored = await this.configs.get<Record<string, unknown>>(this.accountKey(accountId));
    if (!stored) return null;
    const defaultId = await this.getDefaultAccountId();
    const enc: { current: EncryptionService | null } = { current: null };
    return this.toMaskedSummary({ accountId, data: stored, updatedAt: new Date() }, defaultId, enc);
  }

  /** Decrypted account fields, for tool use only — never returned to the client. */
  async getRawAccount(accountId: string): Promise<Record<string, unknown> | null> {
    const stored = await this.configs.get<Record<string, unknown>>(this.accountKey(accountId));
    if (!stored) return null;

    const enc = this.encryption();
    const out: Record<string, unknown> = { ...stored };
    for (const key of this.descriptor.secretFields) {
      const value = stored[key];
      if (typeof value === 'string' && value) {
        const plain = safeDecrypt(enc, value, `${this.descriptor.name}.${accountId}.${key}`);
        if (plain === null) delete out[key];
        else out[key] = plain;
      }
    }
    return out;
  }

  /**
   * Refreshes `raw`'s OAuth token in place when it's within `REFRESH_BUFFER_MS`
   * of `expiresAt`, persisting the result via `saveAccount()` (re-encrypts).
   * A no-op for manual-auth integrations (`descriptor.oauth` absent) and for
   * providers whose tokens don't expire (no `refresh`, e.g. Notion — no
   * `expiresAt` is ever stored for those). Throws `OAuthReauthRequiredError`
   * on a rejected refresh; never deletes or blanks the stored row.
   */
  private async withFreshTokens(accountId: string, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    const oauth = this.descriptor.oauth;
    if (!oauth?.refresh) return raw;

    const expiresAtRaw = raw.expiresAt;
    if (typeof expiresAtRaw !== 'string') return raw;
    const expiresAt = Date.parse(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() <= expiresAt - REFRESH_BUFFER_MS) return raw;

    const refreshToken = raw.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) return raw; // nothing we can refresh with

    const inFlight = this.refreshInFlight.get(accountId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const result = await oauth.refresh!(refreshToken);
        if (!result.ok) {
          logger.warn(
            { tenantId: this.tenantId, integration: this.descriptor.name, accountId, error: result.error },
            'OAuth token refresh rejected by provider',
          );
          throw new OAuthReauthRequiredError(this.descriptor.displayName);
        }
        const fields: Record<string, string> = { accessToken: result.tokens.accessToken };
        if (result.tokens.refreshToken) fields.refreshToken = result.tokens.refreshToken;
        if (result.tokens.expiresAt) fields.expiresAt = result.tokens.expiresAt;
        if (result.tokens.scope) fields.scope = result.tokens.scope;

        await this.saveAccount(accountId, fields, 'system');
        logger.info({ tenantId: this.tenantId, integration: this.descriptor.name, accountId }, 'OAuth token refreshed');
        return { ...raw, ...fields };
      } finally {
        this.refreshInFlight.delete(accountId);
      }
    })();
    this.refreshInFlight.set(accountId, promise);
    return promise;
  }

  private async resolveRaw(accountId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.getRawAccount(accountId);
    if (!raw) return null;
    return this.withFreshTokens(accountId, raw);
  }

  /**
   * Resolves which account a tool call should use: single-mode always resolves
   * `'default'`; multi-mode tries an exact accountId match, then a
   * case-insensitive label match, then the saved default pointer, then (a
   * defensive fallback if the pointer is stale/missing) the sole remaining
   * account when exactly one exists. Transparently refreshes an expiring OAuth
   * token before returning (see `withFreshTokens`).
   */
  async resolveAccount(accountIdOrLabel?: string): Promise<{ accountId: string; raw: Record<string, unknown> } | null> {
    if (this.descriptor.accountMode === 'single') {
      const raw = await this.resolveRaw('default');
      return raw ? { accountId: 'default', raw } : null;
    }

    if (accountIdOrLabel) {
      const direct = await this.resolveRaw(accountIdOrLabel);
      if (direct) return { accountId: accountIdOrLabel, raw: direct };

      const accounts = await this.listAccounts();
      const byLabel = accounts.find((a) => a.label.toLowerCase() === accountIdOrLabel.toLowerCase());
      if (byLabel) {
        const raw = await this.resolveRaw(byLabel.accountId);
        if (raw) return { accountId: byLabel.accountId, raw };
      }
    }

    const defaultId = await this.getDefaultAccountId();
    if (defaultId) {
      const raw = await this.resolveRaw(defaultId);
      if (raw) return { accountId: defaultId, raw };
    }

    const rows = await this.listRawAccountRows();
    if (rows.length === 1) {
      const raw = await this.resolveRaw(rows[0].accountId);
      if (raw) return { accountId: rows[0].accountId, raw };
    }
    return null;
  }

  /**
   * Upsert. A blank or omitted string field preserves whatever is already
   * stored, matching `ClawConnectorConfigService.save`'s rule — so a UI form
   * whose secret inputs were left empty (showing only the mask) never clobbers
   * the real value. Auto-promotes this account to default the first time an
   * integration goes from 0 to 1 connected accounts.
   */
  async saveAccount(
    accountId: string,
    input: Record<string, string | boolean | undefined>,
    updatedBy = 'system',
    opts?: { makeDefault?: boolean; label?: string },
  ): Promise<void> {
    const key = this.accountKey(accountId);
    const existing = await this.configs.get<Record<string, unknown>>(key);
    const wasNew = existing === null || existing === undefined;
    const next: Record<string, unknown> = { ...(existing ?? {}) };

    for (const [field, value] of Object.entries(input)) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue; // blank => keep existing
      next[field] = this.descriptor.secretFields.includes(field) ? this.encryption().encrypt(trimmed) : trimmed;
    }
    if (opts?.label) next.label = opts.label;

    await this.configs.set(key, next, updatedBy);

    if (opts?.makeDefault || (wasNew && (await this.listRawAccountRows()).length === 1)) {
      await this.setDefaultAccountId(accountId, updatedBy);
    }
    logger.info({ tenantId: this.tenantId, integration: this.descriptor.name, accountId }, 'Integration account saved');
  }

  /** Best-effort provider-side revoke — never blocks or fails the local delete. */
  private async tryRevoke(accountId: string): Promise<void> {
    if (!this.descriptor.oauth?.revoke) return;
    try {
      const raw = await this.getRawAccount(accountId);
      if (raw) await this.descriptor.oauth.revoke(raw);
    } catch (error) {
      logger.warn(
        { error, tenantId: this.tenantId, integration: this.descriptor.name, accountId },
        'Provider-side OAuth revoke failed — removing the local copy anyway',
      );
    }
  }

  /** Removes an account; if it was the default, deterministically promotes another or clears the pointer. */
  async removeAccount(accountId: string): Promise<void> {
    await this.tryRevoke(accountId);
    await this.configs.delete(this.accountKey(accountId));

    const defaultId = await this.getDefaultAccountId();
    if (defaultId !== accountId) return;

    const remaining = await this.listRawAccountRows();
    if (remaining.length === 0) {
      await this.configs.delete(this.defaultKey());
      return;
    }
    const promoted = remaining.reduce((earliest, row) => (row.updatedAt < earliest.updatedAt ? row : earliest));
    await this.setDefaultAccountId(promoted.accountId, 'system');
    logger.info(
      { tenantId: this.tenantId, integration: this.descriptor.name, accountId, promoted: promoted.accountId },
      'Removed default integration account — promoted another to default',
    );
  }

  /** Removes every connected account and the default pointer — the list-page "Disconnect" action. */
  async disconnectAll(): Promise<void> {
    const rows = await this.listRawAccountRows();
    await Promise.all(rows.map((row) => this.tryRevoke(row.accountId)));
    await Promise.all(rows.map((row) => this.configs.delete(this.accountKey(row.accountId))));
    await this.configs.delete(this.defaultKey());
    logger.info(
      { tenantId: this.tenantId, integration: this.descriptor.name, removed: rows.length },
      'Disconnected all accounts for integration',
    );
  }
}
