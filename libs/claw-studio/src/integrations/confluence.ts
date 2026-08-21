/**
 * confluence.ts — Confluence Cloud tool-only integration: single-account (one
 * connected site per tenant), same Atlassian API-token Basic auth shape as
 * `jira.ts` (`Buffer.from(`${email}:${apiToken}`).toString('base64')`), read
 * tools for search/pages and an approval-gated write tool for creating pages.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:confluence');

const NOT_CONNECTED = 'Confluence is not connected. Connect a site + API token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Confluence API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function siteBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function confluenceRequest(
  baseUrl: string,
  email: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const basic = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const res = await fetch(`${siteBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Confluence API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const confluenceDescriptor: IntegrationDescriptor = {
  name: 'confluence',
  displayName: 'Confluence',
  description: 'Search spaces, read pages, and draft documentation.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiToken'],
  async verify(fields) {
    const baseUrl = fields.baseUrl?.trim();
    const email = fields.email?.trim();
    const apiToken = fields.apiToken?.trim();
    if (!baseUrl || !email || !apiToken) {
      return { ok: false, error: 'Site URL, email, and API token are all required.' };
    }
    try {
      const me = (await confluenceRequest(baseUrl, email, apiToken, '/wiki/rest/api/user/current')) as {
        displayName?: string;
        email?: string;
      };
      if (!me.displayName && !me.email) {
        return { ok: false, error: 'Confluence did not return a user for this token.' };
      }
      const identity = me.displayName ?? me.email ?? email;
      return { ok: true, detail: `Connected as ${identity}`, meta: { displayName: identity } };
    } catch (error) {
      logger.warn({ error }, 'Confluence verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Confluence verification failed' };
    }
  },
};

export function createConfluenceTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, confluenceDescriptor);

  const confluence_search = tool(
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { baseUrl: baseUrl, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const params = new URLSearchParams({
          cql: `text ~ "${query}"`,
          limit: String(Math.max(1, Math.min(maxResults ?? 10, 20))),
        });
        const result = await confluenceRequest(baseUrl, email, apiToken, `/wiki/rest/api/search?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'confluence_search failed');
        return `Error searching Confluence: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'confluence_search',
      description: 'Search Confluence pages.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const confluence_get_page = tool(
    async ({ pageId }: { pageId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { baseUrl: baseUrl, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const page = await confluenceRequest(
          baseUrl,
          email,
          apiToken,
          `/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,version,space`,
        );
        return truncateOutput(JSON.stringify(page, null, 2), 2500);
      } catch (error) {
        logger.error({ error, pageId }, 'confluence_get_page failed');
        return `Error fetching Confluence page: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'confluence_get_page',
      description: 'Read a Confluence page.',
      schema: z.object({
        pageId: z.string().describe('Confluence page id'),
      }),
    },
  );

  const confluence_create_page = tool(
    async ({
      spaceKey,
      title,
      body,
      parentId,
    }: {
      spaceKey: string;
      title: string;
      body: string;
      parentId?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { baseUrl: baseUrl, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const payload: Record<string, unknown> = {
          type: 'page',
          title,
          space: { key: spaceKey },
          body: { storage: { value: body, representation: 'storage' } },
        };
        if (parentId) payload.ancestors = [{ id: parentId }];
        const created = await confluenceRequest(baseUrl, email, apiToken, '/wiki/rest/api/content', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, spaceKey }, 'confluence_create_page failed');
        return `Error creating Confluence page: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'confluence_create_page',
      description:
        'Create a Confluence page. Body should be Confluence storage-format HTML. Requires approval.',
      schema: z.object({
        spaceKey: z.string().describe('Confluence space key'),
        title: z.string().describe('Page title'),
        body: z.string().describe('Page body, Confluence storage-format HTML'),
        parentId: z.string().optional().describe('Parent page id, to nest this page under another'),
      }),
    },
  );

  return [confluence_search, confluence_get_page, confluence_create_page];
}
