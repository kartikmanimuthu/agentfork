/**
 * stripe.ts — Stripe tool-only integration: single-account (one restricted
 * API key per tenant), Bearer auth, read-only tools over customers, charges,
 * and invoices. OpenWorker ships no write tools for Stripe at all — moving
 * money is deliberately out of scope — and this port keeps that boundary.
 *
 * OpenWorker itself has no `validate` for Stripe (its descriptor has none
 * wired up), so `verify()` here is authored fresh: a GET to `/v1/account`
 * both confirms the key works and gives a human-readable identity to show
 * back (`display_name` / `business_profile.name` / the account id), which is
 * nicer than the cheaper but identity-less `/v1/balance` check.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:stripe');

const STRIPE_API = 'https://api.stripe.com/v1';
const NOT_CONNECTED = 'Stripe is not connected. Connect a restricted API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Stripe API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

async function stripeRequest(apiKey: string, path: string, params?: Record<string, string>): Promise<unknown> {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  const res = await fetch(`${STRIPE_API}${path}${query}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const stripeDescriptor: IntegrationDescriptor = {
  name: 'stripe',
  displayName: 'Stripe',
  description: 'Read-only access to customers, charges, and invoices.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'A restricted API key is required.' };
    try {
      const account = (await stripeRequest(apiKey, '/account')) as {
        id?: string;
        display_name?: string;
        business_profile?: { name?: string };
      };
      const label = account.display_name || account.business_profile?.name || account.id || 'Stripe account';
      return { ok: true, detail: `Connected to ${label}`, meta: { label } };
    } catch (error) {
      logger.warn({ error }, 'Stripe verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Stripe verification failed' };
    }
  },
};

export function createStripeTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, stripeDescriptor);

  const stripe_search_customers = tool(
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await stripeRequest(account.raw.apiKey as string, '/customers/search', {
          query,
          limit: String(clampResults(maxResults)),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'stripe_search_customers failed');
        return `Error searching Stripe customers: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'stripe_search_customers',
      description:
        "Search Stripe customers. Query uses Stripe search syntax, e.g. email:'jane@example.com' or name~'Jane'.",
      schema: z.object({
        query: z.string().describe('Stripe search-syntax query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const stripe_list_charges = tool(
    async ({ customerId, maxResults }: { customerId?: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const params: Record<string, string> = { limit: String(clampResults(maxResults)) };
        if (customerId) params.customer = customerId;
        const result = await stripeRequest(account.raw.apiKey as string, '/charges', params);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, customerId }, 'stripe_list_charges failed');
        return `Error listing Stripe charges: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'stripe_list_charges',
      description: 'List Stripe charges, optionally for one customer.',
      schema: z.object({
        customerId: z.string().optional().describe('Stripe customer id to filter by'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const stripe_list_invoices = tool(
    async ({ customerId, maxResults }: { customerId?: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const params: Record<string, string> = { limit: String(clampResults(maxResults)) };
        if (customerId) params.customer = customerId;
        const result = await stripeRequest(account.raw.apiKey as string, '/invoices', params);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, customerId }, 'stripe_list_invoices failed');
        return `Error listing Stripe invoices: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'stripe_list_invoices',
      description: 'List Stripe invoices, optionally for one customer.',
      schema: z.object({
        customerId: z.string().optional().describe('Stripe customer id to filter by'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  return [stripe_search_customers, stripe_list_charges, stripe_list_invoices];
}
