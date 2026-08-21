/**
 * canva.ts — Canva tool-only integration: a single Canva Connect access token
 * per tenant, read tools for listing/reading designs and a two-step export
 * flow (start a render job, then poll it by id) rather than one blocking
 * call — Canva's own export API is asynchronous.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:canva');

const CANVA_API = 'https://api.canva.com/rest/v1';
const NOT_CONNECTED = 'Canva is not connected. Connect a Canva Connect access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Canva API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function canvaRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${CANVA_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Canva API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const canvaDescriptor: IntegrationDescriptor = {
  name: 'canva',
  displayName: 'Canva',
  description: 'Browse, create, and export designs.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'An access token from a Canva Connect integration is required.' };
    try {
      const profile = (await canvaRequest(accessToken, '/users/me/profile')) as {
        profile?: { display_name?: string };
      };
      const displayName = profile.profile?.display_name;
      if (!displayName) return { ok: false, error: 'Canva did not return a profile for this token.' };
      return { ok: true, detail: `Connected as ${displayName}`, meta: { displayName } };
    } catch (error) {
      logger.warn({ error }, 'Canva verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Canva verification failed' };
    }
  },
};

export function createCanvaTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, canvaDescriptor);

  const canva_list_designs = tool(
    async ({ query, maxResults = 10 }: { query?: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const params = new URLSearchParams({ limit: String(Math.min(Math.max(maxResults, 1), 100)) });
        if (query) params.set('query', query);
        const result = await canvaRequest(accessToken, `/designs?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'canva_list_designs failed');
        return `Error listing Canva designs: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'canva_list_designs',
      description: 'List, or text-search, Canva designs.',
      schema: z.object({
        query: z.string().optional().describe('Free-text search query; omit to list recent designs'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const canva_get_design = tool(
    async ({ designId }: { designId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const design = await canvaRequest(accessToken, `/designs/${encodeURIComponent(designId)}`);
        return truncateOutput(JSON.stringify(design, null, 2), 1500);
      } catch (error) {
        logger.error({ error, designId }, 'canva_get_design failed');
        return `Error fetching Canva design: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'canva_get_design',
      description: "Read a Canva design's metadata (title, pages, urls).",
      schema: z.object({ designId: z.string().describe('Canva design id') }),
    },
  );

  const canva_export_design = tool(
    async ({ designId, format = 'pdf' }: { designId: string; format?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const job = await canvaRequest(accessToken, '/exports', {
          method: 'POST',
          body: JSON.stringify({ design_id: designId, format: { type: format } }),
        });
        return truncateOutput(JSON.stringify(job, null, 2), 1000);
      } catch (error) {
        logger.error({ error, designId }, 'canva_export_design failed');
        return `Error starting Canva export: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'canva_export_design',
      description:
        'Start rendering a Canva design to pdf/png/jpg; returns an export job id to check with canva_get_export.',
      schema: z.object({
        designId: z.string().describe('Canva design id'),
        format: z.enum(['pdf', 'png', 'jpg']).optional().describe('Export format, defaults to pdf'),
      }),
    },
  );

  const canva_get_export = tool(
    async ({ exportId }: { exportId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const job = await canvaRequest(accessToken, `/exports/${encodeURIComponent(exportId)}`);
        return truncateOutput(JSON.stringify(job, null, 2), 1000);
      } catch (error) {
        logger.error({ error, exportId }, 'canva_get_export failed');
        return `Error fetching Canva export: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'canva_get_export',
      description: 'Check a Canva export job started by canva_export_design; returns download URLs once finished.',
      schema: z.object({ exportId: z.string().describe('Export job id returned by canva_export_design') }),
    },
  );

  return [canva_list_designs, canva_get_design, canva_export_design, canva_get_export];
}
