/**
 * asana.ts — Asana tool-only integration: a single personal access token per
 * tenant (Asana's V2 MCP server rejects Dynamic Client Registration, so a
 * one-click OAuth path isn't viable yet — manual token stays the connect
 * path, same as OpenWorker). Read tools for workspaces/tasks and an
 * approval-gated write tool for creating tasks.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:asana');

const ASANA_API = 'https://app.asana.com/api/1.0';
const NOT_CONNECTED = 'Asana is not connected. Connect a personal access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Asana API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function asanaRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ASANA_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Asana API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const asanaDescriptor: IntegrationDescriptor = {
  name: 'asana',
  displayName: 'Asana',
  description: 'Search and read tasks and projects; create, update, and comment.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['token'],
  async verify(fields) {
    const token = fields.token?.trim();
    if (!token) return { ok: false, error: 'A personal access token is required.' };
    try {
      const result = (await asanaRequest(token, '/users/me')) as { data?: { name?: string } };
      const name = result.data?.name;
      if (!name) return { ok: false, error: 'Asana did not return a user for this token.' };
      return { ok: true, detail: `Connected as ${name}`, meta: { name } };
    } catch (error) {
      logger.warn({ error }, 'Asana verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Asana verification failed' };
    }
  },
};

export function createAsanaTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, asanaDescriptor);

  const asana_list_workspaces = tool(
    async () => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const workspaces = await asanaRequest(account.raw.token as string, '/workspaces');
        return truncateOutput(JSON.stringify(workspaces, null, 2), 1500);
      } catch (error) {
        logger.error({ error }, 'asana_list_workspaces failed');
        return `Error listing Asana workspaces: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'asana_list_workspaces',
      description: 'List Asana workspaces (GIDs are needed to search tasks).',
      schema: z.object({}),
    },
  );

  const asana_search_tasks = tool(
    async ({
      workspaceGid,
      query,
      maxResults = 10,
    }: {
      workspaceGid: string;
      query: string;
      maxResults?: number;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const params = new URLSearchParams({
          resource_type: 'task',
          query,
          count: String(maxResults),
        });
        const result = await asanaRequest(
          account.raw.token as string,
          `/workspaces/${encodeURIComponent(workspaceGid)}/typeahead?${params.toString()}`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, workspaceGid, query }, 'asana_search_tasks failed');
        return `Error searching Asana tasks: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'asana_search_tasks',
      description: 'Search Asana tasks by name in a workspace. Get workspaceGid from asana_list_workspaces.',
      schema: z.object({
        workspaceGid: z.string().describe('Asana workspace GID, from asana_list_workspaces'),
        query: z.string().describe('Free-text task name search'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const asana_get_task = tool(
    async ({ taskGid }: { taskGid: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const task = await asanaRequest(account.raw.token as string, `/tasks/${encodeURIComponent(taskGid)}`);
        return truncateOutput(JSON.stringify(task, null, 2), 2000);
      } catch (error) {
        logger.error({ error, taskGid }, 'asana_get_task failed');
        return `Error fetching Asana task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'asana_get_task',
      description: 'Read an Asana task.',
      schema: z.object({ taskGid: z.string().describe('Asana task GID') }),
    },
  );

  const asana_create_task = tool(
    async ({ projectGid, name, notes = '' }: { projectGid: string; name: string; notes?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const task = await asanaRequest(account.raw.token as string, '/tasks', {
          method: 'POST',
          body: JSON.stringify({ data: { name, notes, projects: [projectGid] } }),
        });
        return truncateOutput(JSON.stringify(task, null, 2), 1000);
      } catch (error) {
        logger.error({ error, projectGid }, 'asana_create_task failed');
        return `Error creating Asana task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'asana_create_task',
      description: 'Create an Asana task in a project. Requires approval.',
      schema: z.object({
        projectGid: z.string().describe('Asana project GID'),
        name: z.string().describe('Task name'),
        notes: z.string().optional().describe('Task notes/description'),
      }),
    },
  );

  return [asana_list_workspaces, asana_search_tasks, asana_get_task, asana_create_task];
}
