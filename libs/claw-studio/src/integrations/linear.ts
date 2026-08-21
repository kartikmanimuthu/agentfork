/**
 * linear.ts — Linear tool-only integration: single-account (one API key per
 * tenant), personal-API-key auth sent verbatim in the `Authorization` header
 * (Linear's own convention — no "Bearer" prefix), GraphQL read tools for
 * issues/teams and an approval-gated write tool for creating issues.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:linear');

const LINEAR_API = 'https://api.linear.app/graphql';
const NOT_CONNECTED = 'Linear is not connected. Connect an API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Linear API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

async function linearGraphQl(apiKey: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    // Linear expects the raw API key in Authorization, with no "Bearer" prefix.
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Linear API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const linearDescriptor: IntegrationDescriptor = {
  name: 'linear',
  displayName: 'Linear',
  description: 'Search, read, and create Linear issues.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'A personal API key is required.' };
    try {
      const result = (await linearGraphQl(apiKey, '{ viewer { name } }', {})) as {
        data?: { viewer?: { name?: string } };
      };
      const name = result.data?.viewer?.name;
      if (!name) return { ok: false, error: 'Linear did not return a viewer name for this key.' };
      return { ok: true, detail: `Connected as ${name}`, meta: { name } };
    } catch (error) {
      logger.warn({ error }, 'Linear verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Linear verification failed' };
    }
  },
};

export function createLinearTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, linearDescriptor);

  const linear_search_issues = tool(
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const gql =
          'query($term: String!, $first: Int!) {' +
          ' searchIssues(term: $term, first: $first) {' +
          ' nodes { identifier title url state { name } assignee { name } } } }';
        const result = await linearGraphQl(account.raw.apiKey as string, gql, {
          term: query,
          first: clampResults(maxResults),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'linear_search_issues failed');
        return `Error searching Linear issues: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'linear_search_issues',
      description: 'Search Linear issues by text.',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const linear_get_issue = tool(
    async ({ issueId }: { issueId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const gql =
          'query($id: String!) { issue(id: $id) {' +
          ' identifier title description url state { name } assignee { name }' +
          ' comments { nodes { body user { name } } } } }';
        const result = await linearGraphQl(account.raw.apiKey as string, gql, { id: issueId });
        return truncateOutput(JSON.stringify(result, null, 2), 2500);
      } catch (error) {
        logger.error({ error, issueId }, 'linear_get_issue failed');
        return `Error fetching Linear issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'linear_get_issue',
      description: 'Read a Linear issue (with comments) by ID or key like ENG-123.',
      schema: z.object({
        issueId: z.string().describe('Linear issue ID or key, e.g. ENG-123'),
      }),
    },
  );

  const linear_list_teams = tool(
    async () => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await linearGraphQl(account.raw.apiKey as string, '{ teams { nodes { id key name } } }', {});
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'linear_list_teams failed');
        return `Error listing Linear teams: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'linear_list_teams',
      description: 'List Linear teams (IDs are needed to create issues).',
      schema: z.object({}),
    },
  );

  const linear_create_issue = tool(
    async ({ teamId, title, description }: { teamId: string; title: string; description?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const gql =
          'mutation($input: IssueCreateInput!) { issueCreate(input: $input) {' +
          ' success issue { identifier url } } }';
        const result = await linearGraphQl(account.raw.apiKey as string, gql, {
          input: { teamId, title, description: description ?? '' },
        });
        return truncateOutput(JSON.stringify(result, null, 2), 1000);
      } catch (error) {
        logger.error({ error, teamId }, 'linear_create_issue failed');
        return `Error creating Linear issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'linear_create_issue',
      description: 'Create a Linear issue. Get teamId from linear_list_teams. Requires approval.',
      schema: z.object({
        teamId: z.string().describe('Linear team ID, from linear_list_teams'),
        title: z.string().describe('Issue title'),
        description: z.string().optional().describe('Issue description'),
      }),
    },
  );

  return [linear_search_issues, linear_get_issue, linear_list_teams, linear_create_issue];
}
