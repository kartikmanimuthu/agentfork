/**
 * attio.ts — Attio tool-only integration: multi-account (one row per connected
 * workspace, keyed by the workspace id `verify()` returns), manual API-key
 * auth, read tools for objects/records/notes and an approval-gated write tool
 * for creating notes.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:attio');

const ATTIO_API = 'https://api.attio.com';
const NOT_CONNECTED = 'Attio is not connected. Connect an API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Attio API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

async function attioRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ATTIO_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Attio API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const attioDescriptor: IntegrationDescriptor = {
  name: 'attio',
  displayName: 'Attio',
  description: 'Read your Attio CRM: objects, records, notes.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'An API key is required.' };
    try {
      const self = (await attioRequest(accessToken, '/v2/self')) as {
        workspace_id?: string;
        workspace_name?: string;
      };
      if (!self.workspace_id) {
        return { ok: false, error: 'Attio did not return a workspace id for this key.' };
      }
      const accountId = `attio-${self.workspace_id}`;
      const label = self.workspace_name || self.workspace_id;
      return { ok: true, detail: `Connected to workspace ${label}`, meta: { accountId, label } };
    } catch (error) {
      logger.warn({ error }, 'Attio verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Attio verification failed' };
    }
  },
};

export function createAttioTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, attioDescriptor);

  const attio_list_objects = tool(
    async ({ account }: { account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await attioRequest(resolved.raw.accessToken as string, '/v2/objects');
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'attio_list_objects failed');
        return `Error listing Attio objects: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'attio_list_objects',
      description: 'List Attio object types (companies, people, deals, custom).',
      schema: z.object({
        account: z.string().optional().describe('Attio workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  const attio_query_records = tool(
    async ({
      objectType,
      filterJson,
      maxResults,
      account,
    }: {
      objectType: string;
      filterJson?: string;
      maxResults?: number;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const body: Record<string, unknown> = { limit: clampResults(maxResults, 10, 100) };
        if (filterJson) {
          try {
            body.filter = JSON.parse(filterJson);
          } catch {
            return 'filter_json must be an Attio filter object (JSON)';
          }
        }
        const result = await attioRequest(
          resolved.raw.accessToken as string,
          `/v2/objects/${encodeURIComponent(objectType)}/records/query`,
          { method: 'POST', body: JSON.stringify(body) },
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, objectType }, 'attio_query_records failed');
        return `Error querying Attio records: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'attio_query_records',
      description: "List/filter records of an Attio object (e.g. companies, people); filterJson is an Attio filter object (JSON).",
      schema: z.object({
        objectType: z.string().describe('Attio object type, e.g. companies, people, deals'),
        filterJson: z.string().optional().describe('Attio filter object, as a JSON string'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
        account: z.string().optional().describe('Attio workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  const attio_get_record = tool(
    async ({ objectType, recordId, account }: { objectType: string; recordId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const result = await attioRequest(
          resolved.raw.accessToken as string,
          `/v2/objects/${encodeURIComponent(objectType)}/records/${encodeURIComponent(recordId)}`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 1500);
      } catch (error) {
        logger.error({ error, objectType, recordId }, 'attio_get_record failed');
        return `Error fetching Attio record: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'attio_get_record',
      description: 'Read one Attio record by object type and record id.',
      schema: z.object({
        objectType: z.string().describe('Attio object type, e.g. companies, people, deals'),
        recordId: z.string().describe('Attio record id'),
        account: z.string().optional().describe('Attio workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  const attio_create_note = tool(
    async ({
      parentObject,
      parentRecordId,
      title,
      content,
      account,
    }: {
      parentObject: string;
      parentRecordId: string;
      title: string;
      content: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const created = await attioRequest(resolved.raw.accessToken as string, '/v2/notes', {
          method: 'POST',
          body: JSON.stringify({
            data: {
              parent_object: parentObject,
              parent_record_id: parentRecordId,
              title,
              format: 'plaintext',
              content,
            },
          }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, parentObject, parentRecordId }, 'attio_create_note failed');
        return `Error creating Attio note: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'attio_create_note',
      description: 'Create a note on an Attio record. Requires approval.',
      schema: z.object({
        parentObject: z.string().describe('Attio object type the record belongs to, e.g. companies, people'),
        parentRecordId: z.string().describe('Attio record id to attach the note to'),
        title: z.string().describe('Note title'),
        content: z.string().describe('Note body (plaintext)'),
        account: z.string().optional().describe('Attio workspace account id or label; omit for the default connected workspace'),
      }),
    },
  );

  return [attio_list_objects, attio_query_records, attio_get_record, attio_create_note];
}
