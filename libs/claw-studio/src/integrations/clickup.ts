/**
 * clickup.ts — ClickUp tool-only integration: a single personal API token per
 * tenant, sent verbatim in the `Authorization` header (ClickUp's own
 * convention — no "Bearer" prefix, unlike most other connectors here). Read
 * tools for teams/spaces/lists/tasks and approval-gated write tools for
 * creating/updating tasks and adding comments.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:clickup');

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const NOT_CONNECTED = 'ClickUp is not connected. Connect a personal API token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled ClickUp API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function clickupRequest(apiToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${CLICKUP_API}${path}`, {
    ...init,
    // ClickUp expects the raw personal API token here, not "Bearer <token>".
    headers: { Authorization: apiToken, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ClickUp API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const clickupDescriptor: IntegrationDescriptor = {
  name: 'clickup',
  displayName: 'ClickUp',
  description: 'Search tasks and docs; create and update items.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiToken'],
  async verify(fields) {
    const apiToken = fields.apiToken?.trim();
    if (!apiToken) return { ok: false, error: 'A personal API token is required.' };
    try {
      const result = (await clickupRequest(apiToken, '/user')) as { user?: { username?: string } };
      const username = result.user?.username;
      if (!username) return { ok: false, error: 'ClickUp did not return a user for this token.' };
      return { ok: true, detail: `Connected as ${username}`, meta: { username } };
    } catch (error) {
      logger.warn({ error }, 'ClickUp verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'ClickUp verification failed' };
    }
  },
};

export function createClickupTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, clickupDescriptor);

  const clickup_list_teams = tool(
    async () => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const teams = await clickupRequest(account.raw.apiToken as string, '/team');
        return truncateOutput(JSON.stringify(teams, null, 2), 1500);
      } catch (error) {
        logger.error({ error }, 'clickup_list_teams failed');
        return `Error listing ClickUp teams: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_list_teams',
      description: 'List ClickUp workspaces (team ids are needed to browse spaces).',
      schema: z.object({}),
    },
  );

  const clickup_list_spaces = tool(
    async ({ teamId }: { teamId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const spaces = await clickupRequest(
          account.raw.apiToken as string,
          `/team/${encodeURIComponent(teamId)}/space`,
        );
        return truncateOutput(JSON.stringify(spaces, null, 2), 1500);
      } catch (error) {
        logger.error({ error, teamId }, 'clickup_list_spaces failed');
        return `Error listing ClickUp spaces: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_list_spaces',
      description: 'List spaces in a ClickUp workspace.',
      schema: z.object({ teamId: z.string().describe('ClickUp team (workspace) id, from clickup_list_teams') }),
    },
  );

  const clickup_list_lists = tool(
    async ({ spaceId }: { spaceId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const lists = await clickupRequest(
          account.raw.apiToken as string,
          `/space/${encodeURIComponent(spaceId)}/list`,
        );
        return truncateOutput(JSON.stringify(lists, null, 2), 1500);
      } catch (error) {
        logger.error({ error, spaceId }, 'clickup_list_lists failed');
        return `Error listing ClickUp lists: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_list_lists',
      description: 'List folderless lists in a ClickUp space (list ids hold the tasks).',
      schema: z.object({ spaceId: z.string().describe('ClickUp space id, from clickup_list_spaces') }),
    },
  );

  const clickup_list_tasks = tool(
    async ({
      listId,
      includeClosed = false,
      maxResults = 10,
    }: {
      listId: string;
      includeClosed?: boolean;
      maxResults?: number;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = (await clickupRequest(
          account.raw.apiToken as string,
          `/list/${encodeURIComponent(listId)}/task?include_closed=${includeClosed ? 'true' : 'false'}&page=0`,
        )) as { tasks?: unknown[] };
        const tasks = Array.isArray(result.tasks) ? result.tasks.slice(0, maxResults) : result.tasks;
        return truncateOutput(JSON.stringify({ ...result, tasks }, null, 2), 2000);
      } catch (error) {
        logger.error({ error, listId }, 'clickup_list_tasks failed');
        return `Error listing ClickUp tasks: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_list_tasks',
      description: 'List tasks in a ClickUp list.',
      schema: z.object({
        listId: z.string().describe('ClickUp list id, from clickup_list_lists'),
        includeClosed: z.boolean().optional().describe('Include closed tasks, defaults to false'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const clickup_get_task = tool(
    async ({ taskId }: { taskId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const task = await clickupRequest(
          account.raw.apiToken as string,
          `/task/${encodeURIComponent(taskId)}?include_subtasks=true`,
        );
        return truncateOutput(JSON.stringify(task, null, 2), 2000);
      } catch (error) {
        logger.error({ error, taskId }, 'clickup_get_task failed');
        return `Error fetching ClickUp task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_get_task',
      description: 'Read a ClickUp task (with subtasks) by id.',
      schema: z.object({ taskId: z.string().describe('ClickUp task id') }),
    },
  );

  const clickup_create_task = tool(
    async ({ listId, name, description = '' }: { listId: string; name: string; description?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const task = await clickupRequest(account.raw.apiToken as string, `/list/${encodeURIComponent(listId)}/task`, {
          method: 'POST',
          body: JSON.stringify({ name, description }),
        });
        return truncateOutput(JSON.stringify(task, null, 2), 1000);
      } catch (error) {
        logger.error({ error, listId }, 'clickup_create_task failed');
        return `Error creating ClickUp task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_create_task',
      description: 'Create a ClickUp task in a list. Requires approval.',
      schema: z.object({
        listId: z.string().describe('ClickUp list id, from clickup_list_lists'),
        name: z.string().describe('Task name'),
        description: z.string().optional().describe('Task description'),
      }),
    },
  );

  const clickup_update_task = tool(
    async ({
      taskId,
      name,
      description,
      status,
    }: {
      taskId: string;
      name?: string;
      description?: string;
      status?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const body: Record<string, string> = {};
        if (name) body.name = name;
        if (description) body.description = description;
        if (status) body.status = status;
        if (Object.keys(body).length === 0) {
          return 'Nothing to update: pass name, description, or status.';
        }
        const task = await clickupRequest(account.raw.apiToken as string, `/task/${encodeURIComponent(taskId)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return truncateOutput(JSON.stringify(task, null, 2), 1000);
      } catch (error) {
        logger.error({ error, taskId }, 'clickup_update_task failed');
        return `Error updating ClickUp task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_update_task',
      description: "Update a ClickUp task's name, description, or status. Requires approval.",
      schema: z.object({
        taskId: z.string().describe('ClickUp task id'),
        name: z.string().optional().describe('New task name'),
        description: z.string().optional().describe('New task description'),
        status: z.string().optional().describe('New task status'),
      }),
    },
  );

  const clickup_add_comment = tool(
    async ({ taskId, text }: { taskId: string; text: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const comment = await clickupRequest(
          account.raw.apiToken as string,
          `/task/${encodeURIComponent(taskId)}/comment`,
          { method: 'POST', body: JSON.stringify({ comment_text: text }) },
        );
        return truncateOutput(JSON.stringify(comment, null, 2), 1000);
      } catch (error) {
        logger.error({ error, taskId }, 'clickup_add_comment failed');
        return `Error adding ClickUp comment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'clickup_add_comment',
      description: 'Comment on a ClickUp task. Requires approval.',
      schema: z.object({
        taskId: z.string().describe('ClickUp task id'),
        text: z.string().describe('Comment text'),
      }),
    },
  );

  return [
    clickup_list_teams,
    clickup_list_spaces,
    clickup_list_lists,
    clickup_list_tasks,
    clickup_get_task,
    clickup_create_task,
    clickup_update_task,
    clickup_add_comment,
  ];
}
