/**
 * dropbox.ts — Dropbox tool-only integration: a single pasted access token per
 * tenant (OpenWorker's own public repo has no real OAuth handshake either —
 * only its private cloud broker does — so this matches `github.ts`'s
 * token-paste shape, not a redirect flow like `google-drive.ts`), read-only
 * tools for searching/browsing/reading files.
 *
 * Dropbox's HTTP API is POST-based with JSON bodies for nearly everything
 * (unlike GitHub/Box's GET-heavy REST style) — every tool here mirrors that.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:dropbox');

const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_API = 'https://content.dropboxapi.com/2';
const NOT_CONNECTED = 'Dropbox is not connected. Connect an access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Dropbox API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Dropbox's API treats the root folder as an empty string, not `"/"` — passing
 * `"/"` itself is a documented 400 (`path/malformed`). Any other path must
 * start with `/`, so a bare `"notes"` from the model gets normalized rather
 * than rejected.
 */
function dropboxPath(path: string | undefined): string {
  const trimmed = (path ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

async function dropboxRequest(accessToken: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${DROPBOX_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? null),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dropbox API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Content-download endpoints pass args via the `Dropbox-API-Arg` header, not a JSON body, and return the file bytes as the response body. */
async function dropboxDownload(accessToken: string, path: string, arg: unknown): Promise<string> {
  const res = await fetch(`${DROPBOX_CONTENT_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify(arg),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dropbox API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

export const dropboxDescriptor: IntegrationDescriptor = {
  name: 'dropbox',
  displayName: 'Dropbox',
  description: 'Search, browse, and read files in Dropbox.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'An access token is required.' };
    try {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const detail = typeof data === 'object' && data ? (data.error_summary ?? data.error) : null;
        return { ok: false, error: String(detail ?? `HTTP ${res.status}`) };
      }
      const email = data?.email;
      if (!email) return { ok: false, error: 'Dropbox did not return an account email for this token.' };
      return { ok: true, detail: `Connected as ${email}`, meta: { email } };
    } catch (error) {
      logger.warn({ error }, 'Dropbox verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Dropbox verification failed' };
    }
  },
};

export function createDropboxTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, dropboxDescriptor);

  const dropbox_search = tool(
    async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await dropboxRequest(account.raw.accessToken as string, '/files/search_v2', {
          query,
          options: { max_results: Math.max(1, Math.min(maxResults, 20)) },
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'dropbox_search failed');
        return `Error searching Dropbox: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'dropbox_search',
      description: 'Search Dropbox files and folders by name/content.',
      schema: z.object({
        query: z.string().describe('Search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const dropbox_list_folder = tool(
    async ({ path = '' }: { path?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await dropboxRequest(account.raw.accessToken as string, '/files/list_folder', {
          path: dropboxPath(path),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, path }, 'dropbox_list_folder failed');
        return `Error listing Dropbox folder: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'dropbox_list_folder',
      description: 'List a Dropbox folder. Empty path is the root.',
      schema: z.object({
        path: z.string().optional().describe('Folder path, e.g. "/Reports"; omit or empty for the root'),
      }),
    },
  );

  const dropbox_read_file = tool(
    async ({ path }: { path: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const text = await dropboxDownload(account.raw.accessToken as string, '/files/download', {
          path: dropboxPath(path),
        });
        return truncateOutput(JSON.stringify({ path, content: text }, null, 2), 3000);
      } catch (error) {
        logger.error({ error, path }, 'dropbox_read_file failed');
        return `Error reading Dropbox file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'dropbox_read_file',
      description: 'Read a text file from Dropbox by path.',
      schema: z.object({
        path: z.string().describe('File path, e.g. "/Reports/notes.txt"'),
      }),
    },
  );

  return [dropbox_search, dropbox_list_folder, dropbox_read_file];
}
