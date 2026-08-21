/**
 * google-calendar.ts — Google Calendar tool-only integration: OAuth via the
 * shared Google provider, multi-account (one row per connected Google
 * account), read tools for listing events/checking availability and
 * approval-gated write tools for creating/updating/deleting events.
 *
 * A separate connector from Gmail (see gmail.ts) even though both can share
 * the same connected Google account and the same Google Cloud OAuth app —
 * each requests only the scope it needs and stores its own account row,
 * matching how the OpenWorker reference project treats these as fully
 * separate connectors.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import { verifyViaIdentify } from './oauth-broker';
import { createGoogleOAuthProvider } from './oauth-providers/google';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:google-calendar');

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const NOT_CONNECTED = 'Google Calendar is not connected. Connect a Google account in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Calendar API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function calendarRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Calendar API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const googleCalendarOAuthProvider = createGoogleOAuthProvider(['https://www.googleapis.com/auth/calendar.events']);

export const googleCalendarDescriptor: IntegrationDescriptor = {
  name: 'google_calendar',
  displayName: 'Google Calendar',
  description: 'Check availability and manage events on the connected Google account\'s calendar.',
  accountMode: 'multi',
  authMode: 'oauth',
  secretFields: ['accessToken', 'refreshToken'],
  verify: verifyViaIdentify(googleCalendarOAuthProvider),
  oauth: googleCalendarOAuthProvider,
};

export function createGoogleCalendarTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, googleCalendarDescriptor);

  const google_calendar_list_events = tool(
    async ({
      timeMin,
      timeMax,
      query,
      account,
      limit = 10,
    }: {
      timeMin?: string;
      timeMax?: string;
      query?: string;
      account?: string;
      limit?: number;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(limit),
          timeMin: timeMin ?? new Date().toISOString(),
        });
        if (timeMax) params.set('timeMax', timeMax);
        if (query) params.set('q', query);

        const result = (await calendarRequest(accessToken, `/calendars/primary/events?${params.toString()}`)) as {
          items?: Array<{ id?: string; summary?: string; start?: unknown; end?: unknown }>;
        };
        return truncateOutput(JSON.stringify(result.items ?? [], null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'google_calendar_list_events failed');
        return `Error listing calendar events: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_calendar_list_events',
      description: 'List upcoming events on the connected Google Calendar, optionally filtered by a time range or text query.',
      schema: z.object({
        timeMin: z.string().optional().describe('ISO 8601 start of range, defaults to now'),
        timeMax: z.string().optional().describe('ISO 8601 end of range'),
        query: z.string().optional().describe('Free-text filter over event fields'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const google_calendar_check_availability = tool(
    async ({ timeMin, timeMax, account }: { timeMin: string; timeMax: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const result = (await calendarRequest(accessToken, '/freeBusy', {
          method: 'POST',
          body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
        })) as { calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } } };
        const busy = result.calendars?.primary?.busy ?? [];
        return truncateOutput(JSON.stringify({ busy }, null, 2), 1500);
      } catch (error) {
        logger.error({ error }, 'google_calendar_check_availability failed');
        return `Error checking availability: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_calendar_check_availability',
      description: 'Check busy/free time blocks on the connected calendar within a time range.',
      schema: z.object({
        timeMin: z.string().describe('ISO 8601 range start'),
        timeMax: z.string().describe('ISO 8601 range end'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  const google_calendar_create_event = tool(
    async ({
      summary,
      startDateTime,
      endDateTime,
      description,
      attendees,
      account,
    }: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
      description?: string;
      attendees?: string[];
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const created = await calendarRequest(accessToken, '/calendars/primary/events', {
          method: 'POST',
          body: JSON.stringify({
            summary,
            description,
            start: { dateTime: startDateTime },
            end: { dateTime: endDateTime },
            ...(attendees?.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
          }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error }, 'google_calendar_create_event failed');
        return `Error creating calendar event: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_calendar_create_event',
      description: 'Create a new event on the connected Google Calendar. Requires approval.',
      schema: z.object({
        summary: z.string().describe('Event title'),
        startDateTime: z.string().describe('ISO 8601 start time'),
        endDateTime: z.string().describe('ISO 8601 end time'),
        description: z.string().optional().describe('Event description'),
        attendees: z.array(z.string()).optional().describe('Attendee email addresses'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  const google_calendar_update_event = tool(
    async ({
      eventId,
      summary,
      startDateTime,
      endDateTime,
      description,
      account,
    }: {
      eventId: string;
      summary?: string;
      startDateTime?: string;
      endDateTime?: string;
      description?: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const patch: Record<string, unknown> = {};
        if (summary) patch.summary = summary;
        if (description) patch.description = description;
        if (startDateTime) patch.start = { dateTime: startDateTime };
        if (endDateTime) patch.end = { dateTime: endDateTime };

        const updated = await calendarRequest(accessToken, `/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        return truncateOutput(JSON.stringify(updated, null, 2), 1000);
      } catch (error) {
        logger.error({ error, eventId }, 'google_calendar_update_event failed');
        return `Error updating calendar event: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_calendar_update_event',
      description: 'Update an existing Google Calendar event by id. Requires approval.',
      schema: z.object({
        eventId: z.string().describe('Event id (from google_calendar_list_events results)'),
        summary: z.string().optional().describe('New title'),
        startDateTime: z.string().optional().describe('New ISO 8601 start time'),
        endDateTime: z.string().optional().describe('New ISO 8601 end time'),
        description: z.string().optional().describe('New description'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  const google_calendar_delete_event = tool(
    async ({ eventId, account }: { eventId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        await calendarRequest(accessToken, `/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
        return `Deleted event ${eventId}.`;
      } catch (error) {
        logger.error({ error, eventId }, 'google_calendar_delete_event failed');
        return `Error deleting calendar event: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'google_calendar_delete_event',
      description: 'Delete a Google Calendar event by id. Requires approval.',
      schema: z.object({
        eventId: z.string().describe('Event id (from google_calendar_list_events results)'),
        account: z.string().optional().describe('Connected Google account email or label; omit for the default'),
      }),
    },
  );

  return [
    google_calendar_list_events,
    google_calendar_check_availability,
    google_calendar_create_event,
    google_calendar_update_event,
    google_calendar_delete_event,
  ];
}
