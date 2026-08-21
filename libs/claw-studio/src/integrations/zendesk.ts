/**
 * zendesk.ts — Zendesk tool-only integration: single-account (one subdomain +
 * agent per tenant), Zendesk's own Basic-auth convention
 * (`{email}/token:{apiToken}`, note the literal `/token` suffix on the
 * username — distinct from the plain `email:apiToken` shape used by
 * Jira/Confluence), read tools for search/tickets and an approval-gated
 * write tool for creating tickets.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:zendesk');

const NOT_CONNECTED = 'Zendesk is not connected. Connect a subdomain + API token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Zendesk API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function zendeskBase(subdomain: string): string {
  return `https://${subdomain.trim()}.zendesk.com`;
}

async function zendeskRequest(
  subdomain: string,
  email: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  // Zendesk's API-token auth format: the username is the agent email with a
  // literal "/token" suffix, password is the API token itself.
  const basic = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
  const res = await fetch(`${zendeskBase(subdomain)}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zendesk API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const zendeskDescriptor: IntegrationDescriptor = {
  name: 'zendesk',
  displayName: 'Zendesk',
  description: 'Search tickets, summarize customer context, and draft replies.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiToken'],
  async verify(fields) {
    const subdomain = fields.subdomain?.trim();
    const email = fields.email?.trim();
    const apiToken = fields.apiToken?.trim();
    if (!subdomain || !email || !apiToken) {
      return { ok: false, error: 'Subdomain, agent email, and API token are all required.' };
    }
    try {
      const me = (await zendeskRequest(subdomain, email, apiToken, '/api/v2/users/me.json')) as {
        user?: { email?: string; name?: string };
      };
      const identity = me.user?.email ?? me.user?.name;
      if (!identity) return { ok: false, error: 'Zendesk did not return a user for this token.' };
      return { ok: true, detail: `Connected as ${identity}`, meta: { identity } };
    } catch (error) {
      logger.warn({ error }, 'Zendesk verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Zendesk verification failed' };
    }
  },
};

export function createZendeskTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, zendeskDescriptor);

  const zendesk_search = tool(
    async ({ query }: { query: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { subdomain, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const params = new URLSearchParams({ query });
        const result = await zendeskRequest(subdomain, email, apiToken, `/api/v2/search.json?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'zendesk_search failed');
        return `Error searching Zendesk: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'zendesk_search',
      description: 'Search Zendesk tickets/users/articles.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
      }),
    },
  );

  const zendesk_get_ticket = tool(
    async ({ ticketId }: { ticketId: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { subdomain, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const ticket = await zendeskRequest(subdomain, email, apiToken, `/api/v2/tickets/${ticketId}.json`);
        return truncateOutput(JSON.stringify(ticket, null, 2), 2000);
      } catch (error) {
        logger.error({ error, ticketId }, 'zendesk_get_ticket failed');
        return `Error fetching Zendesk ticket: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'zendesk_get_ticket',
      description: 'Read a Zendesk ticket.',
      schema: z.object({
        ticketId: z.number().int().describe('Zendesk ticket id'),
      }),
    },
  );

  const zendesk_create_ticket = tool(
    async ({
      subject,
      body,
      requesterEmail,
    }: {
      subject: string;
      body: string;
      requesterEmail?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { subdomain, email, apiToken: apiToken } = account.raw as Record<string, string>;
        const ticket: Record<string, unknown> = { subject, comment: { body } };
        if (requesterEmail) ticket.requester = { email: requesterEmail };
        const created = await zendeskRequest(subdomain, email, apiToken, '/api/v2/tickets.json', {
          method: 'POST',
          body: JSON.stringify({ ticket }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, subject }, 'zendesk_create_ticket failed');
        return `Error creating Zendesk ticket: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'zendesk_create_ticket',
      description: 'Create a Zendesk ticket. Requires approval.',
      schema: z.object({
        subject: z.string().describe('Ticket subject'),
        body: z.string().describe('Ticket comment body'),
        requesterEmail: z.string().optional().describe('Email of the ticket requester, if different from the agent'),
      }),
    },
  );

  return [zendesk_search, zendesk_get_ticket, zendesk_create_ticket];
}
