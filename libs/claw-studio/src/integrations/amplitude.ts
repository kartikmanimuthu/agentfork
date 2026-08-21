/**
 * amplitude.ts — Amplitude tool-only integration: multi-account, HTTP Basic
 * auth (`apiKey:secretKey`), read-only active-users + event-totals tools.
 *
 * Amplitude's whoami endpoint (`/api/2/annotations`) carries no user or
 * project identity at all, so unlike PostHog/Mixpanel there is no natural
 * account key in either the request or the response. Matching OpenWorker's
 * own fallback (`descriptors.py` `_validate_amplitude`, `account_field=
 * "@identity"`), the account is named after the tail of the API key itself
 * — `key …abc123` — so two connected Amplitude projects stay distinguishable
 * in the accounts list even though nothing about the project surfaces from
 * the API.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:amplitude');

const AMPLITUDE_API = 'https://amplitude.com/api/2';
const NOT_CONNECTED = 'Amplitude is not connected. Connect an API key + secret key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Amplitude API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function basicAuthHeader(apiKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
}

/** Names an account after the key's tail since Amplitude's API returns no identity to key on. */
function accountIdFromApiKey(apiKey: string): string {
  return `key …${apiKey.slice(-6)}`;
}

async function amplitudeRequest(
  apiKey: string,
  secretKey: string,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${AMPLITUDE_API}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), {
    headers: { Authorization: basicAuthHeader(apiKey, secretKey) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Amplitude API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const amplitudeDescriptor: IntegrationDescriptor = {
  name: 'amplitude',
  displayName: 'Amplitude',
  description: 'Query Amplitude charts data: active users, event totals.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['apiKey', 'secretKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    const secretKey = fields.secretKey?.trim();
    if (!apiKey || !secretKey) return { ok: false, error: 'An API key and secret key are required.' };
    try {
      const res = await fetch(`${AMPLITUDE_API}/annotations`, {
        headers: { Authorization: basicAuthHeader(apiKey, secretKey) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `Amplitude API error ${res.status}: ${text.slice(0, 300)}` };
      }
      const accountId = accountIdFromApiKey(apiKey);
      return { ok: true, detail: `Connected (${accountId})`, meta: { accountId, label: accountId } };
    } catch (error) {
      logger.warn({ error }, 'Amplitude verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Amplitude verification failed' };
    }
  },
};

export function createAmplitudeTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, amplitudeDescriptor);

  const amplitude_active_users = tool(
    async ({
      start,
      end,
      metric = 'active',
      account,
    }: {
      start: string;
      end: string;
      metric?: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { apiKey: apiKey, secretKey: secretKey } = resolved.raw as Record<string, string>;
        const validMetric = metric === 'active' || metric === 'new' ? metric : 'active';
        const result = await amplitudeRequest(apiKey, secretKey, '/users', {
          m: validMetric,
          start: start.replace(/-/g, ''),
          end: end.replace(/-/g, ''),
          i: '1',
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'amplitude_active_users failed');
        return `Error fetching Amplitude active users: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'amplitude_active_users',
      description: 'Amplitude daily active or new users between two dates (YYYYMMDD or YYYY-MM-DD).',
      schema: z.object({
        start: z.string().describe('Start date, YYYYMMDD or YYYY-MM-DD'),
        end: z.string().describe('End date, YYYYMMDD or YYYY-MM-DD'),
        metric: z.enum(['active', 'new']).optional().describe('active | new, defaults to active'),
        account: z.string().optional().describe('Amplitude project account id or label; omit for the default connected project'),
      }),
    },
  );

  const amplitude_event_totals = tool(
    async ({
      eventType,
      start,
      end,
      account,
    }: {
      eventType: string;
      start: string;
      end: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { apiKey: apiKey, secretKey: secretKey } = resolved.raw as Record<string, string>;
        const result = await amplitudeRequest(apiKey, secretKey, '/events/segmentation', {
          e: JSON.stringify({ event_type: eventType }),
          start: start.replace(/-/g, ''),
          end: end.replace(/-/g, ''),
          m: 'totals',
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, eventType }, 'amplitude_event_totals failed');
        return `Error fetching Amplitude event totals: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'amplitude_event_totals',
      description: 'Daily totals for one Amplitude event between two dates.',
      schema: z.object({
        eventType: z.string().describe('Amplitude event type to total'),
        start: z.string().describe('Start date, YYYYMMDD or YYYY-MM-DD'),
        end: z.string().describe('End date, YYYYMMDD or YYYY-MM-DD'),
        account: z.string().optional().describe('Amplitude project account id or label; omit for the default connected project'),
      }),
    },
  );

  return [amplitude_active_users, amplitude_event_totals];
}
