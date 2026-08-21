/**
 * gitlab.ts — GitLab tool-only integration: single-account (one personal
 * access token per tenant), works against gitlab.com or a self-hosted
 * instance via an optional `baseUrl`, `PRIVATE-TOKEN` header auth, read
 * tools for search/issues/merge requests and an approval-gated write tool
 * for creating issues.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:gitlab');

const NOT_CONNECTED = 'GitLab is not connected. Connect a personal access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled GitLab API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Falls back to gitlab.com when no self-hosted baseUrl is configured, matching OpenWorker's `_gitlab_api`. */
function gitlabApiBase(baseUrl?: string): string {
  const base = (baseUrl?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
  return `${base}/api/v4`;
}

/** Clamps a caller-supplied result count the same way OpenWorker's `_clamp` does. */
function clampResults(n: number | undefined, fallback = 10, ceiling = 20): number {
  return Math.max(1, Math.min(n ?? fallback, ceiling));
}

async function gitlabRequest(token: string, baseUrl: string | undefined, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${gitlabApiBase(baseUrl)}${path}`, {
    ...init,
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitLab API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const gitlabDescriptor: IntegrationDescriptor = {
  name: 'gitlab',
  displayName: 'GitLab',
  description: 'Work with issues and merge requests on GitLab.com or self-hosted.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['token'],
  async verify(fields) {
    const token = fields.token?.trim();
    if (!token) return { ok: false, error: 'A personal access token is required.' };
    const baseUrl = fields.baseUrl?.trim();
    try {
      const user = (await gitlabRequest(token, baseUrl, '/user')) as { username?: string };
      if (!user.username) return { ok: false, error: 'GitLab did not return a username for this token.' };
      return { ok: true, detail: `Connected as @${user.username}`, meta: { username: user.username } };
    } catch (error) {
      logger.warn({ error }, 'GitLab verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'GitLab verification failed' };
    }
  },
};

export function createGitlabTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, gitlabDescriptor);

  const gitlab_search = tool(
    async ({ query, scope = 'issues', maxResults }: { query: string; scope?: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { token, baseUrl: baseUrl } = account.raw as Record<string, string>;
        const kind = scope === 'projects' || scope === 'issues' || scope === 'merge_requests' ? scope : 'issues';
        const params = new URLSearchParams({
          scope: kind,
          search: query,
          per_page: String(clampResults(maxResults)),
        });
        const result = await gitlabRequest(token, baseUrl, `/search?${params.toString()}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'gitlab_search failed');
        return `Error searching GitLab: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gitlab_search',
      description: 'Search GitLab projects, issues, or merge_requests (scope).',
      schema: z.object({
        query: z.string().describe('Free-text search query'),
        scope: z.enum(['projects', 'issues', 'merge_requests']).optional().describe('What to search, defaults to issues'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const gitlab_get_issue = tool(
    async ({ project, issueIid }: { project: string; issueIid: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { token, baseUrl: baseUrl } = account.raw as Record<string, string>;
        const issue = await gitlabRequest(
          token,
          baseUrl,
          `/projects/${encodeURIComponent(project)}/issues/${issueIid}`,
        );
        return truncateOutput(JSON.stringify(issue, null, 2), 2000);
      } catch (error) {
        logger.error({ error, project, issueIid }, 'gitlab_get_issue failed');
        return `Error fetching GitLab issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gitlab_get_issue',
      description: 'Read a GitLab issue. project is an ID or full path like group/repo.',
      schema: z.object({
        project: z.string().describe('GitLab project ID or full path, e.g. group/repo'),
        issueIid: z.number().int().describe('Issue internal ID (IID)'),
      }),
    },
  );

  const gitlab_get_merge_request = tool(
    async ({ project, mrIid }: { project: string; mrIid: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { token, baseUrl: baseUrl } = account.raw as Record<string, string>;
        const mr = await gitlabRequest(
          token,
          baseUrl,
          `/projects/${encodeURIComponent(project)}/merge_requests/${mrIid}`,
        );
        return truncateOutput(JSON.stringify(mr, null, 2), 2000);
      } catch (error) {
        logger.error({ error, project, mrIid }, 'gitlab_get_merge_request failed');
        return `Error fetching GitLab merge request: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gitlab_get_merge_request',
      description: 'Read a GitLab merge request. project is an ID or full path like group/repo.',
      schema: z.object({
        project: z.string().describe('GitLab project ID or full path, e.g. group/repo'),
        mrIid: z.number().int().describe('Merge request internal ID (IID)'),
      }),
    },
  );

  const gitlab_create_issue = tool(
    async ({ project, title, description }: { project: string; title: string; description?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { token, baseUrl: baseUrl } = account.raw as Record<string, string>;
        const created = await gitlabRequest(token, baseUrl, `/projects/${encodeURIComponent(project)}/issues`, {
          method: 'POST',
          body: JSON.stringify({ title, description: description ?? '' }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, project }, 'gitlab_create_issue failed');
        return `Error creating GitLab issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gitlab_create_issue',
      description: 'Create a GitLab issue. Requires approval.',
      schema: z.object({
        project: z.string().describe('GitLab project ID or full path, e.g. group/repo'),
        title: z.string().describe('Issue title'),
        description: z.string().optional().describe('Issue description'),
      }),
    },
  );

  return [gitlab_search, gitlab_get_issue, gitlab_get_merge_request, gitlab_create_issue];
}
