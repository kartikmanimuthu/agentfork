/**
 * mixpanel.ts — Mixpanel tool-only integration: multi-account (one row per
 * connected project, keyed by the `projectId` field itself — Mixpanel's
 * whoami endpoint returns no project id, only the service account's own
 * identity), service-account auth via HTTP Basic (`username:secret`),
 * read-only segmentation + top-events tools.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:mixpanel');

const MIXPANEL_API = 'https://mixpanel.com/api';
const NOT_CONNECTED = 'Mixpanel is not connected. Connect a service account in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Mixpanel API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function basicAuthHeader(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
}

async function mixpanelRequest(username: string, secret: string, path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${MIXPANEL_API}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), {
    headers: { Authorization: basicAuthHeader(username, secret) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Mixpanel API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const mixpanelDescriptor: IntegrationDescriptor = {
  name: 'mixpanel',
  displayName: 'Mixpanel',
  description: 'Query Mixpanel events and segmentation.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['secret'],
  async verify(fields) {
    const username = fields.username?.trim();
    const secret = fields.secret?.trim();
    if (!username || !secret) return { ok: false, error: 'A service account username and secret are required.' };
    const projectId = fields.projectId?.trim();
    if (!projectId) return { ok: false, error: 'A project ID is required.' };
    try {
      const res = await fetch('https://mixpanel.com/api/app/me', {
        headers: { Authorization: basicAuthHeader(username, secret) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `Mixpanel API error ${res.status}: ${text.slice(0, 300)}` };
      }
      return {
        ok: true,
        detail: `Connected as ${username} (project ${projectId})`,
        meta: { accountId: projectId, label: `${username} (project ${projectId})` },
      };
    } catch (error) {
      logger.warn({ error }, 'Mixpanel verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Mixpanel verification failed' };
    }
  },
};

export function createMixpanelTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, mixpanelDescriptor);

  const mixpanel_segmentation = tool(
    async ({
      event,
      fromDate,
      toDate,
      unit = 'day',
      where,
      account,
    }: {
      event: string;
      fromDate: string;
      toDate: string;
      unit?: string;
      where?: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { username, secret, projectId: projectId } = resolved.raw as Record<string, string>;
        const validUnit = (['minute', 'hour', 'day', 'week', 'month'] as const).includes(unit as never) ? unit : 'day';
        const params: Record<string, string> = {
          projectId: projectId,
          event,
          from_date: fromDate,
          to_date: toDate,
          unit: validUnit,
        };
        if (where) params.where = where;
        const result = await mixpanelRequest(username, secret, '/query/segmentation', params);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, event }, 'mixpanel_segmentation failed');
        return `Error querying Mixpanel segmentation: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'mixpanel_segmentation',
      description:
        'Mixpanel event counts over a date range (YYYY-MM-DD), optionally filtered by a `where` expression like properties["plan"]=="pro".',
      schema: z.object({
        event: z.string().describe('Event name to segment'),
        fromDate: z.string().describe('Start date, YYYY-MM-DD'),
        toDate: z.string().describe('End date, YYYY-MM-DD'),
        unit: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional().describe('Bucket size, defaults to day'),
        where: z.string().optional().describe('Segmentation filter expression'),
        account: z.string().optional().describe('Mixpanel project account id or label; omit for the default connected project'),
      }),
    },
  );

  const mixpanel_top_events = tool(
    async ({ maxResults = 10, account }: { maxResults?: number; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { username, secret, projectId: projectId } = resolved.raw as Record<string, string>;
        const clamped = Math.max(1, Math.min(maxResults, 100));
        const result = await mixpanelRequest(username, secret, '/query/events/top', {
          projectId: projectId,
          type: 'general',
          limit: String(clamped),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'mixpanel_top_events failed');
        return `Error listing Mixpanel top events: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'mixpanel_top_events',
      description: "Today's top Mixpanel events by volume.",
      schema: z.object({
        maxResults: z.number().int().optional().describe('Max results, defaults to 10, capped at 100'),
        account: z.string().optional().describe('Mixpanel project account id or label; omit for the default connected project'),
      }),
    },
  );

  return [mixpanel_segmentation, mixpanel_top_events];
}
