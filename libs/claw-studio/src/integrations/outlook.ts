/**
 * outlook.ts — Outlook tool-only integration via Microsoft Graph: OAuth (see
 * oauth-providers/microsoft.ts), multi-account, mail + calendar combined in
 * one connector (proportionally fewer tools than splitting into two, mirroring
 * how Gmail/Calendar are split only because that's how the OpenWorker
 * reference project itself models Google, not because mail+calendar can't
 * reasonably share one connector).
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import { verifyViaIdentify } from './oauth-broker';
import { createMicrosoftOAuthProvider } from './oauth-providers/microsoft';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:outlook');

const GRAPH_API = 'https://graph.microsoft.com/v1.0/me';
const NOT_CONNECTED = 'Outlook is not connected. Connect a Microsoft account in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Graph API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function graphRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${GRAPH_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Microsoft Graph API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const outlookOAuthProvider = createMicrosoftOAuthProvider(['Mail.Read', 'Mail.Send', 'Calendars.ReadWrite', 'User.Read']);

export const outlookDescriptor: IntegrationDescriptor = {
  name: 'outlook',
  displayName: 'Outlook',
  description: 'Search and send mail, and manage calendar events, on the connected Microsoft account.',
  accountMode: 'multi',
  authMode: 'oauth',
  secretFields: ['accessToken', 'refreshToken'],
  verify: verifyViaIdentify(outlookOAuthProvider),
  oauth: outlookOAuthProvider,
};

export function createOutlookTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, outlookDescriptor);

  const outlook_search_messages = tool(
    async ({ query, account, limit = 10 }: { query: string; account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const params = new URLSearchParams({ $search: `"${query}"`, $top: String(limit) });
        const result = (await graphRequest(accessToken, `/messages?${params.toString()}`, {
          headers: { ConsistencyLevel: 'eventual' },
        })) as { value?: Array<{ id?: string; subject?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime?: string; bodyPreview?: string }> };

        const messages = (result.value ?? []).map((m) => ({
          id: m.id,
          subject: m.subject,
          from: m.from?.emailAddress?.address,
          receivedDateTime: m.receivedDateTime,
          preview: m.bodyPreview,
        }));
        return truncateOutput(JSON.stringify(messages, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'outlook_search_messages failed');
        return `Error searching Outlook mail: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'outlook_search_messages',
      description: 'Search mail in the connected Outlook mailbox.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        account: z.string().optional().describe('Connected Microsoft account email or label; omit for the default'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const outlook_list_events = tool(
    async ({ account, limit = 10 }: { account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const params = new URLSearchParams({ $top: String(limit), $orderby: 'start/dateTime' });
        const result = (await graphRequest(accessToken, `/events?${params.toString()}`)) as {
          value?: Array<{ id?: string; subject?: string; start?: unknown; end?: unknown }>;
        };
        return truncateOutput(JSON.stringify(result.value ?? [], null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'outlook_list_events failed');
        return `Error listing Outlook calendar events: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'outlook_list_events',
      description: 'List upcoming events on the connected Outlook calendar.',
      schema: z.object({
        account: z.string().optional().describe('Connected Microsoft account email or label; omit for the default'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const outlook_send_message = tool(
    async ({ to, subject, body, account }: { to: string; subject: string; body: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        await graphRequest(accessToken, '/sendMail', {
          method: 'POST',
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
            },
          }),
        });
        return `Sent to ${to}.`;
      } catch (error) {
        logger.error({ error, to }, 'outlook_send_message failed');
        return `Error sending Outlook mail: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'outlook_send_message',
      description: 'Send an email from the connected Outlook mailbox. Requires approval.',
      schema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        account: z.string().optional().describe('Connected Microsoft account email or label; omit for the default'),
      }),
    },
  );

  const outlook_create_event = tool(
    async ({
      subject,
      startDateTime,
      endDateTime,
      attendees,
      account,
    }: {
      subject: string;
      startDateTime: string;
      endDateTime: string;
      attendees?: string[];
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const created = await graphRequest(accessToken, '/events', {
          method: 'POST',
          body: JSON.stringify({
            subject,
            start: { dateTime: startDateTime, timeZone: 'UTC' },
            end: { dateTime: endDateTime, timeZone: 'UTC' },
            ...(attendees?.length
              ? { attendees: attendees.map((address) => ({ emailAddress: { address }, type: 'required' })) }
              : {}),
          }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error }, 'outlook_create_event failed');
        return `Error creating Outlook calendar event: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'outlook_create_event',
      description: 'Create a new event on the connected Outlook calendar. Requires approval.',
      schema: z.object({
        subject: z.string().describe('Event title'),
        startDateTime: z.string().describe('ISO 8601 start time (UTC)'),
        endDateTime: z.string().describe('ISO 8601 end time (UTC)'),
        attendees: z.array(z.string()).optional().describe('Attendee email addresses'),
        account: z.string().optional().describe('Connected Microsoft account email or label; omit for the default'),
      }),
    },
  );

  return [outlook_search_messages, outlook_list_events, outlook_send_message, outlook_create_event];
}
