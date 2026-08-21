/**
 * hunter.ts — Hunter tool-only integration: multi-account, manual API-key
 * auth. Hunter's own convention puts the key in the query string, never a
 * header — every request appends `api_key` to whatever other params the call
 * needs. Matching OpenWorker's `account_field="@identity"`, the account is
 * keyed by the email `/v2/account` returns for the key, since Hunter has no
 * separate workspace/account id of its own. Read-only email-finding tools.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:hunter');

const HUNTER_API = 'https://api.hunter.io/v2';
const NOT_CONNECTED = 'Hunter is not connected. Connect an API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Hunter API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

/** Turns a free-text identity into a stable, slug-like account id; falls back to 'default'. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'default';
}

/**
 * Hunter authenticates via an `api_key` query-string param, not a header —
 * this appends it alongside whatever other params the call already has,
 * matching OpenWorker's `_hunter_get`.
 */
async function hunterRequest(apiKey: string, path: string, params: Record<string, string> = {}): Promise<unknown> {
  const query = new URLSearchParams({ ...params, api_key: apiKey }).toString();
  const res = await fetch(`${HUNTER_API}/${path}?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hunter API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const hunterDescriptor: IntegrationDescriptor = {
  name: 'hunter',
  displayName: 'Hunter',
  description: 'Find and verify professional email addresses by domain.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'An API key is required.' };
    try {
      const result = (await hunterRequest(apiKey, 'account')) as { data?: { email?: string } };
      const email = result.data?.email;
      if (!email) return { ok: false, error: 'Hunter did not return an account email for this key.' };
      const accountId = `hunter-${slugify(email)}`;
      return { ok: true, detail: `Connected as ${email}`, meta: { accountId, label: email } };
    } catch (error) {
      logger.warn({ error }, 'Hunter verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Hunter verification failed' };
    }
  },
};

export function createHunterTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, hunterDescriptor);

  const hunter_domain_search = tool(
    async ({ domain, maxResults, account }: { domain: string; maxResults?: number; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await hunterRequest(resolved.raw.apiKey as string, 'domain-search', {
          domain,
          limit: String(clampResults(maxResults)),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, domain }, 'hunter_domain_search failed');
        return `Error searching Hunter domain: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hunter_domain_search',
      description: 'Find published email addresses for a company domain (Hunter).',
      schema: z.object({
        domain: z.string().describe('Company domain, e.g. acme.com'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
        account: z.string().optional().describe('Hunter account id or label; omit for the default connected account'),
      }),
    },
  );

  const hunter_find_email = tool(
    async ({
      domain,
      firstName,
      lastName,
      account,
    }: {
      domain: string;
      firstName: string;
      lastName: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await hunterRequest(resolved.raw.apiKey as string, 'email-finder', {
          domain,
          first_name: firstName,
          last_name: lastName,
        });
        return truncateOutput(JSON.stringify(result, null, 2), 1500);
      } catch (error) {
        logger.error({ error, domain, firstName, lastName }, 'hunter_find_email failed');
        return `Error finding Hunter email: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hunter_find_email',
      description: "Find a person's most likely email address from their name and company domain (Hunter).",
      schema: z.object({
        domain: z.string().describe('Company domain, e.g. acme.com'),
        firstName: z.string().describe('Person first name'),
        lastName: z.string().describe('Person last name'),
        account: z.string().optional().describe('Hunter account id or label; omit for the default connected account'),
      }),
    },
  );

  const hunter_verify_email = tool(
    async ({ email, account }: { email: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await hunterRequest(resolved.raw.apiKey as string, 'email-verifier', { email });
        return truncateOutput(JSON.stringify(result, null, 2), 1000);
      } catch (error) {
        logger.error({ error, email }, 'hunter_verify_email failed');
        return `Error verifying Hunter email: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hunter_verify_email',
      description: 'Check whether an email address is deliverable (Hunter).',
      schema: z.object({
        email: z.string().describe('Email address to verify'),
        account: z.string().optional().describe('Hunter account id or label; omit for the default connected account'),
      }),
    },
  );

  return [hunter_domain_search, hunter_find_email, hunter_verify_email];
}
