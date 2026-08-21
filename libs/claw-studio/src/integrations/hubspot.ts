/**
 * hubspot.ts — HubSpot tool-only integration: multi-account (one row per
 * connected portal, keyed by the portal id `verify()` returns), private-app
 * access token auth, read tools for contacts and approval-gated write tools
 * for notes/contact updates.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:hubspot');

const HUBSPOT_API = 'https://api.hubapi.com';
const NOT_CONNECTED = 'HubSpot is not connected. Connect a private-app access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled HubSpot API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function hubspotRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HubSpot API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const hubspotDescriptor: IntegrationDescriptor = {
  name: 'hubspot',
  displayName: 'HubSpot',
  description: 'Search and update contacts, and log notes, in your HubSpot CRM.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['token'],
  async verify(fields) {
    const token = fields.token?.trim();
    if (!token) return { ok: false, error: 'A private-app access token is required.' };
    try {
      const details = (await hubspotRequest(token, '/account-info/v3/details')) as {
        portalId?: number;
        accountType?: string;
      };
      if (!details.portalId) {
        return { ok: false, error: 'HubSpot did not return a portal id for this token.' };
      }
      const accountId = `hub-${details.portalId}`;
      return {
        ok: true,
        detail: `Connected to portal ${details.portalId}`,
        meta: { accountId, label: `Portal ${details.portalId}`, portalId: String(details.portalId) },
      };
    } catch (error) {
      logger.warn({ error }, 'HubSpot verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'HubSpot verification failed' };
    }
  },
};

export function createHubspotTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, hubspotDescriptor);

  const hubspot_search_contacts = tool(
    async ({ query, account, limit = 10 }: { query: string; account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await hubspotRequest(resolved.raw.token as string, '/crm/v3/objects/contacts/search', {
          method: 'POST',
          body: JSON.stringify({
            query,
            limit,
            properties: ['firstname', 'lastname', 'email', 'company', 'phone'],
          }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'hubspot_search_contacts failed');
        return `Error searching HubSpot contacts: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hubspot_search_contacts',
      description: 'Search HubSpot contacts by name, email, or company.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        account: z.string().optional().describe('HubSpot portal account id or label; omit for the default connected portal'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const hubspot_get_contact = tool(
    async ({ contactId, account }: { contactId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const contact = await hubspotRequest(
          resolved.raw.token as string,
          `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=firstname,lastname,email,company,phone`,
        );
        return truncateOutput(JSON.stringify(contact, null, 2), 1500);
      } catch (error) {
        logger.error({ error, contactId }, 'hubspot_get_contact failed');
        return `Error fetching HubSpot contact: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hubspot_get_contact',
      description: 'Get a single HubSpot contact by its record id.',
      schema: z.object({
        contactId: z.string().describe('HubSpot contact record id'),
        account: z.string().optional().describe('HubSpot portal account id or label; omit for the default connected portal'),
      }),
    },
  );

  const hubspot_create_note = tool(
    async ({ contactId, note, account }: { contactId: string; note: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const created = await hubspotRequest(resolved.raw.token as string, '/crm/v3/objects/notes', {
          method: 'POST',
          body: JSON.stringify({
            properties: { hs_note_body: note, hs_timestamp: Date.now() },
            associations: [
              {
                to: { id: contactId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
              },
            ],
          }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, contactId }, 'hubspot_create_note failed');
        return `Error creating HubSpot note: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hubspot_create_note',
      description: 'Log a note on a HubSpot contact. Requires approval.',
      schema: z.object({
        contactId: z.string().describe('HubSpot contact record id'),
        note: z.string().describe('Note body'),
        account: z.string().optional().describe('HubSpot portal account id or label; omit for the default connected portal'),
      }),
    },
  );

  const hubspot_update_contact = tool(
    async ({
      contactId,
      properties,
      account,
    }: {
      contactId: string;
      properties: Record<string, string>;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const updated = await hubspotRequest(
          resolved.raw.token as string,
          `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
          { method: 'PATCH', body: JSON.stringify({ properties }) },
        );
        return truncateOutput(JSON.stringify(updated, null, 2), 1000);
      } catch (error) {
        logger.error({ error, contactId }, 'hubspot_update_contact failed');
        return `Error updating HubSpot contact: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'hubspot_update_contact',
      description: 'Update properties on a HubSpot contact (e.g. firstname, lastname, company, phone). Requires approval.',
      schema: z.object({
        contactId: z.string().describe('HubSpot contact record id'),
        properties: z.record(z.string(), z.string()).describe('Property name → new value pairs'),
        account: z.string().optional().describe('HubSpot portal account id or label; omit for the default connected portal'),
      }),
    },
  );

  return [hubspot_search_contacts, hubspot_get_contact, hubspot_create_note, hubspot_update_contact];
}
