/**
 * oauth-state.ts — CSRF protection for the OAuth authorize/callback round trip.
 *
 * Stateless: the signed value round-trips through the provider verbatim as
 * the `state` query param, so there is no server-side row or cookie to manage.
 * TenantId is deliberately NOT carried here — it's re-derived from the live
 * NextAuth session at callback time (the same browser's cookies persist across
 * the external redirect), same as every other integration route resolves it.
 * A stolen `state` value replayed against a different tenant's session still
 * can't complete without also intercepting the real provider redirect, since
 * the provider's `code` is single-use and only ever delivered to the browser
 * that completed the actual consent screen.
 *
 * Uses a dedicated `OAUTH_STATE_SECRET`, not `NEXTAUTH_SECRET` — this package
 * can only import `libs/shared`'s env module, whose `NEXTAUTH_SECRET` is
 * optional and not the same value Mission Control's own sessions are signed
 * with (see `apps/mission-control/lib/env.ts`), so reusing it would just be an
 * accidental name collision, not real key reuse.
 */

import crypto from 'crypto';
import { env, createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:integrations:oauth-state');

const STATE_TTL_MS = 10 * 60 * 1000;
const DOMAIN_PREFIX = 'integration-oauth-state:';

export class OAuthStateSecretUnavailableError extends Error {
  constructor() {
    super('OAuth is not configured — OAUTH_STATE_SECRET must be set (at least 32 characters).');
    this.name = 'OAuthStateSecretUnavailableError';
  }
}

function secret(): string {
  if (!env.OAUTH_STATE_SECRET) throw new OAuthStateSecretUnavailableError();
  return env.OAUTH_STATE_SECRET;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(DOMAIN_PREFIX + payload).digest('base64url');
}

export function signOAuthState(integration: string): string {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${integration}:${nonce}:${expiresAt}`;
  const payloadEncoded = Buffer.from(payload).toString('base64url');
  return `${payloadEncoded}.${sign(payload)}`;
}

export function verifyOAuthState(integration: string, state: string): boolean {
  try {
    const [payloadEncoded, signature] = state.split('.');
    if (!payloadEncoded || !signature) return false;

    const payload = Buffer.from(payloadEncoded, 'base64url').toString('utf8');
    const expected = sign(payload);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      logger.warn({ integration }, 'OAuth state signature mismatch');
      return false;
    }

    const [stateIntegration, , expiresAtRaw] = payload.split(':');
    if (stateIntegration !== integration) {
      logger.warn({ integration, stateIntegration }, 'OAuth state was signed for a different integration');
      return false;
    }
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      logger.warn({ integration }, 'OAuth state expired');
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ error, integration }, 'OAuth state verification threw');
    return false;
  }
}
