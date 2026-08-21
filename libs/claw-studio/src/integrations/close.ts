/**
 * close.ts — Close tool-only integration: single-account (one API key per
 * tenant), HTTP Basic auth where the API key is the username and the
 * password is left blank (Close's own convention — there is no separate
 * password), read tools for leads/opportunities and approval-gated write
 * tools for creating leads, updating opportunities, and logging notes.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:close');

const CLOSE_API = 'https://api.close.com/api/v1';
const NOT_CONNECTED = 'Close is not connected. Connect an API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Close API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

/** Close authenticates with HTTP Basic auth: the API key as username, blank password. */
function closeAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

async function closeRequest(apiKey: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${CLOSE_API}${path}`, {
    ...init,
    headers: { Authorization: closeAuthHeader(apiKey), 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Close API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const closeDescriptor: IntegrationDescriptor = {
  name: 'close',
  displayName: 'Close',
  description: 'Read and update leads, contacts, and opportunities in the CRM.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'An API key is required.' };
    try {
      const me = (await closeRequest(apiKey, '/me/')) as { email?: string };
      if (!me.email) return { ok: false, error: 'Close did not return an account email for this key.' };
      return { ok: true, detail: `Connected as ${me.email}`, meta: { email: me.email } };
    } catch (error) {
      logger.warn({ error }, 'Close verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Close verification failed' };
    }
  },
};

export function createCloseTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, closeDescriptor);

  const close_search_leads = tool(
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const params = new URLSearchParams({ query, _limit: String(clampResults(maxResults)) });
        const result = await closeRequest(account.raw.apiKey as string, `/lead/?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'close_search_leads failed');
        return `Error searching Close leads: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_search_leads',
      description: 'Search Close leads (supports Close\'s search syntax, e.g. "status:potential acme").',
      schema: z.object({
        query: z.string().describe('Close search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const close_get_lead = tool(
    async ({ leadId }: { leadId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await closeRequest(account.raw.apiKey as string, `/lead/${encodeURIComponent(leadId)}/`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, leadId }, 'close_get_lead failed');
        return `Error fetching Close lead: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_get_lead',
      description: 'Read a Close lead (contacts, opportunities, addresses) by id.',
      schema: z.object({ leadId: z.string().describe('Close lead id') }),
    },
  );

  const close_list_opportunities = tool(
    async ({ leadId, maxResults }: { leadId?: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const params = new URLSearchParams({ _limit: String(clampResults(maxResults)) });
        if (leadId) params.set('lead_id', leadId);
        const result = await closeRequest(account.raw.apiKey as string, `/opportunity/?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, leadId }, 'close_list_opportunities failed');
        return `Error listing Close opportunities: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_list_opportunities',
      description: 'List Close opportunities, optionally for one lead.',
      schema: z.object({
        leadId: z.string().optional().describe('Close lead id to filter by'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const close_create_lead = tool(
    async ({
      name,
      contactName,
      contactEmail,
    }: {
      name: string;
      contactName?: string;
      contactEmail?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const body: Record<string, unknown> = { name };
        if (contactName || contactEmail) {
          const contact: Record<string, unknown> = { name: contactName ?? '' };
          if (contactEmail) contact.emails = [{ email: contactEmail }];
          body.contacts = [contact];
        }
        const created = await closeRequest(account.raw.apiKey as string, '/lead/', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, name }, 'close_create_lead failed');
        return `Error creating Close lead: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_create_lead',
      description: 'Create a Close lead (company), optionally with one contact. Requires approval.',
      schema: z.object({
        name: z.string().describe('Lead (company) name'),
        contactName: z.string().optional().describe('Contact name'),
        contactEmail: z.string().optional().describe('Contact email'),
      }),
    },
  );

  const close_update_opportunity = tool(
    async ({
      opportunityId,
      statusId,
      note,
    }: {
      opportunityId: string;
      statusId?: string;
      note?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const body: Record<string, unknown> = {};
        if (statusId) body.status_id = statusId;
        if (note) body.note = note;
        if (Object.keys(body).length === 0) return 'Nothing to update: pass statusId or note.';
        const updated = await closeRequest(account.raw.apiKey as string, `/opportunity/${encodeURIComponent(opportunityId)}/`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return truncateOutput(JSON.stringify(updated, null, 2), 1000);
      } catch (error) {
        logger.error({ error, opportunityId }, 'close_update_opportunity failed');
        return `Error updating Close opportunity: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_update_opportunity',
      description: "Update a Close opportunity's status or note. Requires approval.",
      schema: z.object({
        opportunityId: z.string().describe('Close opportunity id'),
        statusId: z.string().optional().describe('New status id'),
        note: z.string().optional().describe('Note to attach to the opportunity'),
      }),
    },
  );

  const close_log_note = tool(
    async ({ leadId, note }: { leadId: string; note: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const created = await closeRequest(account.raw.apiKey as string, '/activity/note/', {
          method: 'POST',
          body: JSON.stringify({ lead_id: leadId, note }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, leadId }, 'close_log_note failed');
        return `Error logging Close note: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'close_log_note',
      description: "Log a note on a Close lead's timeline. Requires approval.",
      schema: z.object({
        leadId: z.string().describe('Close lead id'),
        note: z.string().describe('Note body'),
      }),
    },
  );

  return [
    close_search_leads,
    close_get_lead,
    close_list_opportunities,
    close_create_lead,
    close_update_opportunity,
    close_log_note,
  ];
}
