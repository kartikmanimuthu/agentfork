/**
 * notion.ts — Notion tool-only integration: OAuth (see oauth-providers/notion.ts),
 * multi-account (one row per connected workspace), read tools for
 * searching/reading pages and an approval-gated write tool for creating one.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import { verifyViaIdentify } from './oauth-broker';
import { notionOAuthProvider } from './oauth-providers/notion';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:notion');

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const NOT_CONNECTED = 'Notion is not connected. Connect a workspace in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Notion API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

interface NotionRichText {
  plain_text?: string;
}

interface NotionPage {
  id?: string;
  url?: string;
  properties?: Record<string, { type?: string; title?: NotionRichText[] }>;
}

async function notionRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

function pageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? '').join('');
      if (text) return text;
    }
  }
  return '(untitled)';
}

export const notionDescriptor: IntegrationDescriptor = {
  name: 'notion',
  displayName: 'Notion',
  description: 'Search, read, and create pages in the Notion workspaces you connect.',
  accountMode: 'multi',
  authMode: 'oauth',
  secretFields: ['accessToken'],
  verify: verifyViaIdentify(notionOAuthProvider),
  oauth: notionOAuthProvider,
};

export function createNotionTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, notionDescriptor);

  const notion_search_pages = tool(
    async ({ query, account, limit = 10 }: { query: string; account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;
        const result = (await notionRequest(accessToken, '/search', {
          method: 'POST',
          body: JSON.stringify({
            query,
            filter: { value: 'page', property: 'object' },
            page_size: limit,
          }),
        })) as { results?: NotionPage[] };
        const pages = (result.results ?? []).map((p) => ({ id: p.id, title: pageTitle(p), url: p.url }));
        return truncateOutput(JSON.stringify(pages, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'notion_search_pages failed');
        return `Error searching Notion: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'notion_search_pages',
      description: 'Search pages in the connected Notion workspace by title/content.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        account: z.string().optional().describe('Notion workspace account id or label; omit for the default connected workspace'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const notion_get_page = tool(
    async ({ pageId, account }: { pageId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;
        const [page, blocks] = await Promise.all([
          notionRequest(accessToken, `/pages/${encodeURIComponent(pageId)}`) as Promise<NotionPage>,
          notionRequest(accessToken, `/blocks/${encodeURIComponent(pageId)}/children?page_size=100`) as Promise<{
            results?: Array<{ type?: string; [key: string]: unknown }>;
          }>,
        ]);
        const text = (blocks.results ?? [])
          .map((block) => {
            const body = block.type ? (block as Record<string, unknown>)[block.type] : undefined;
            const richText = (body as { rich_text?: NotionRichText[] } | undefined)?.rich_text;
            return Array.isArray(richText) ? richText.map((t) => t.plain_text ?? '').join('') : '';
          })
          .filter(Boolean)
          .join('\n');
        return truncateOutput(JSON.stringify({ title: pageTitle(page), url: page.url, content: text }, null, 2), 3000);
      } catch (error) {
        logger.error({ error, pageId }, 'notion_get_page failed');
        return `Error reading Notion page: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'notion_get_page',
      description: 'Read a Notion page\'s title and text content by its page id (from notion_search_pages results).',
      schema: z.object({
        pageId: z.string().describe('Notion page id'),
        account: z.string().optional().describe('Notion workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  const notion_create_page = tool(
    async ({
      parentPageId,
      title,
      content,
      account,
    }: {
      parentPageId: string;
      title: string;
      content?: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;
        const created = (await notionRequest(accessToken, '/pages', {
          method: 'POST',
          body: JSON.stringify({
            parent: { page_id: parentPageId },
            properties: { title: { title: [{ text: { content: title } }] } },
            ...(content
              ? { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }] }
              : {}),
          }),
        })) as NotionPage;
        return truncateOutput(JSON.stringify({ id: created.id, url: created.url }, null, 2), 500);
      } catch (error) {
        logger.error({ error, parentPageId }, 'notion_create_page failed');
        return `Error creating Notion page: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'notion_create_page',
      description: 'Create a new Notion page under an existing parent page. Requires approval.',
      schema: z.object({
        parentPageId: z.string().describe('Existing Notion page id to create the new page under'),
        title: z.string().describe('Title of the new page'),
        content: z.string().optional().describe('Plain-text paragraph content for the new page'),
        account: z.string().optional().describe('Notion workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  return [notion_search_pages, notion_get_page, notion_create_page];
}
