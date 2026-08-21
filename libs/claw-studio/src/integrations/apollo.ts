/**
 * apollo.ts — Apollo.io tool-only integration: multi-account, manual API-key
 * auth. Apollo's own API carries no account identity (its health check just
 * confirms the key works), so — matching OpenWorker's `account_field="@identity"`
 * — the account is keyed by the user-chosen `label` field instead of anything
 * the API returns. Read-only enrichment/search tools only.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:apollo');

const APOLLO_API = 'https://api.apollo.io/api/v1';
const NOT_CONNECTED = 'Apollo is not connected. Connect an API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Apollo API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

/** Turns a free-text label into a stable, slug-like account id; falls back to 'default'. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'default';
}

function apolloHeaders(apiKey: string): Record<string, string> {
  return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
}

async function apolloRequest(apiKey: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${APOLLO_API}${path}`, {
    ...init,
    headers: { ...apolloHeaders(apiKey), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Apollo API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const apolloDescriptor: IntegrationDescriptor = {
  name: 'apollo',
  displayName: 'Apollo.io',
  description: 'Enrich people and companies; search the B2B database.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'An API key is required.' };
    try {
      await apolloRequest(apiKey, '/auth/health');
      // Apollo's health check carries no account identity — the user-chosen
      // label (or 'default' if left blank) IS the identity, matching
      // OpenWorker's `_validate_apollo`.
      const identity = fields.label?.trim() || 'default';
      const accountId = `apollo-${slugify(identity)}`;
      return { ok: true, detail: `Connected as ${identity}`, meta: { accountId, label: identity } };
    } catch (error) {
      logger.warn({ error }, 'Apollo verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Apollo verification failed' };
    }
  },
};

export function createApolloTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, apolloDescriptor);

  const apollo_enrich_person = tool(
    async ({
      email,
      name,
      companyDomain,
      account,
    }: {
      email?: string;
      name?: string;
      companyDomain?: string;
      account?: string;
    }) => {
      try {
        if (!email && !name) return 'Provide an email, a name, or both.';
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const body: Record<string, string> = {};
        if (email) body.email = email;
        if (name) body.name = name;
        if (companyDomain) body.domain = companyDomain;
        const result = await apolloRequest(resolved.raw.apiKey as string, '/people/match', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, email, name }, 'apollo_enrich_person failed');
        return `Error enriching Apollo person: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'apollo_enrich_person',
      description:
        "Enrich a person from Apollo: title, company, LinkedIn, location — by email and/or name (+ optional company domain).",
      schema: z.object({
        email: z.string().optional().describe('Person email to enrich'),
        name: z.string().optional().describe('Person full name to enrich'),
        companyDomain: z.string().optional().describe('Company domain, improves match accuracy'),
        account: z.string().optional().describe('Apollo account id or label; omit for the default connected account'),
      }),
    },
  );

  const apollo_enrich_company = tool(
    async ({ domain, account }: { domain: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const query = new URLSearchParams({ domain }).toString();
        const result = await apolloRequest(resolved.raw.apiKey as string, `/organizations/enrich?${query}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, domain }, 'apollo_enrich_company failed');
        return `Error enriching Apollo company: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'apollo_enrich_company',
      description: 'Enrich a company from Apollo by domain: size, industry, funding, tech stack.',
      schema: z.object({
        domain: z.string().describe('Company domain, e.g. acme.com'),
        account: z.string().optional().describe('Apollo account id or label; omit for the default connected account'),
      }),
    },
  );

  const apollo_search_people = tool(
    async ({ query, maxResults, account }: { query: string; maxResults?: number; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await apolloRequest(resolved.raw.apiKey as string, '/mixed_people/search', {
          method: 'POST',
          body: JSON.stringify({ q_keywords: query, page: 1, per_page: clampResults(maxResults) }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'apollo_search_people failed');
        return `Error searching Apollo people: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'apollo_search_people',
      description: "Keyword-search people in Apollo's B2B database (e.g. 'VP engineering fintech Berlin').",
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
        account: z.string().optional().describe('Apollo account id or label; omit for the default connected account'),
      }),
    },
  );

  return [apollo_enrich_person, apollo_enrich_company, apollo_search_people];
}
