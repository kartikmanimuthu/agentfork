/**
 * box.ts — Box tool-only integration: a single pasted developer/OAuth access
 * token per tenant (OpenWorker's own public repo has no real OAuth handshake
 * either — only its private cloud broker does — so this matches
 * `github.ts`'s token-paste shape, not a redirect flow like
 * `google-drive.ts`), read-only tools for searching/browsing/reading files.
 *
 * Unlike Dropbox, Box's API is a conventional GET-based REST API.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:box');

const BOX_API = 'https://api.box.com/2.0';
/** Box's root folder id is the literal string "0", not empty or "/". */
const BOX_ROOT_FOLDER_ID = '0';
const NOT_CONNECTED = 'Box is not connected. Connect an access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Box API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function boxRequest(accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(`${BOX_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Box API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** The content endpoint returns raw file bytes, not JSON — read as text directly rather than through `boxRequest`. */
async function boxDownload(accessToken: string, path: string): Promise<string> {
  const res = await fetch(`${BOX_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Box API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

export const boxDescriptor: IntegrationDescriptor = {
  name: 'box',
  displayName: 'Box',
  description: 'Search, browse, and read files in Box.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'A Box developer token or OAuth access token is required.' };
    try {
      const res = await fetch(`${BOX_API}/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const detail = typeof data === 'object' && data ? (data.message ?? data.error) : null;
        return { ok: false, error: String(detail ?? `HTTP ${res.status}`) };
      }
      const login = data?.login;
      if (!login) return { ok: false, error: 'Box did not return a login for this token.' };
      return { ok: true, detail: `Connected as ${login}`, meta: { login } };
    } catch (error) {
      logger.warn({ error }, 'Box verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Box verification failed' };
    }
  },
};

export function createBoxTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, boxDescriptor);

  const box_search = tool(
    async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const limit = Math.max(1, Math.min(maxResults, 20));
        const result = await boxRequest(
          account.raw.accessToken as string,
          `/search?query=${encodeURIComponent(query)}&limit=${limit}`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'box_search failed');
        return `Error searching Box: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'box_search',
      description: 'Search Box files and folders.',
      schema: z.object({
        query: z.string().describe('Search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const box_list_folder = tool(
    async ({ folderId = BOX_ROOT_FOLDER_ID }: { folderId?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await boxRequest(
          account.raw.accessToken as string,
          `/folders/${encodeURIComponent(folderId)}/items`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, folderId }, 'box_list_folder failed');
        return `Error listing Box folder: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'box_list_folder',
      description: 'List items in a Box folder. Folder "0" is the root.',
      schema: z.object({
        folderId: z.string().optional().describe('Box folder id; omit for the root folder ("0")'),
      }),
    },
  );

  const box_read_file = tool(
    async ({ fileId }: { fileId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const text = await boxDownload(account.raw.accessToken as string, `/files/${encodeURIComponent(fileId)}/content`);
        return truncateOutput(JSON.stringify({ fileId, content: text }, null, 2), 3000);
      } catch (error) {
        logger.error({ error, fileId }, 'box_read_file failed');
        return `Error reading Box file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'box_read_file',
      description: 'Read a text file from Box by file ID.',
      schema: z.object({
        fileId: z.string().describe('Box file id'),
      }),
    },
  );

  return [box_search, box_list_folder, box_read_file];
}
