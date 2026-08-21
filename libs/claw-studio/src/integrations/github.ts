/**
 * github.ts — GitHub tool-only integration: a single personal access token per
 * tenant (no OAuth app/install flow in this phase), read tools for
 * issues/repos and approval-gated write tools for creating issues/comments.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:github');

const GITHUB_API = 'https://api.github.com';
const NOT_CONNECTED = 'GitHub is not connected. Connect a personal access token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled GitHub API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

async function githubRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const githubDescriptor: IntegrationDescriptor = {
  name: 'github',
  displayName: 'GitHub',
  description: 'Work with issues, pull requests, and repositories.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['token'],
  async verify(fields) {
    const token = fields.token?.trim();
    if (!token) return { ok: false, error: 'A personal access token is required.' };
    try {
      const user = (await githubRequest(token, '/user')) as { login?: string };
      return { ok: true, detail: `Connected as ${user.login ?? 'unknown user'}`, meta: { login: user.login ?? '' } };
    } catch (error) {
      logger.warn({ error }, 'GitHub verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'GitHub verification failed' };
    }
  },
};

export function createGithubTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, githubDescriptor);

  const github_list_issues = tool(
    async ({ owner, repo, state = 'open' }: { owner: string; repo: string; state?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const issues = await githubRequest(
          account.raw.token as string,
          `/repos/${owner}/${repo}/issues?state=${encodeURIComponent(state)}&per_page=20`,
        );
        return truncateOutput(JSON.stringify(issues, null, 2), 2000);
      } catch (error) {
        logger.error({ error, owner, repo }, 'github_list_issues failed');
        return `Error listing GitHub issues: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'github_list_issues',
      description: 'List issues on a GitHub repository.',
      schema: z.object({
        owner: z.string().describe('Repository owner (user or org)'),
        repo: z.string().describe('Repository name'),
        state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state filter, defaults to open'),
      }),
    },
  );

  const github_get_issue = tool(
    async ({ owner, repo, issueNumber }: { owner: string; repo: string; issueNumber: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const issue = await githubRequest(account.raw.token as string, `/repos/${owner}/${repo}/issues/${issueNumber}`);
        return truncateOutput(JSON.stringify(issue, null, 2), 2000);
      } catch (error) {
        logger.error({ error, owner, repo, issueNumber }, 'github_get_issue failed');
        return `Error fetching GitHub issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'github_get_issue',
      description: 'Get a single GitHub issue by number, including its comments count.',
      schema: z.object({
        owner: z.string().describe('Repository owner (user or org)'),
        repo: z.string().describe('Repository name'),
        issueNumber: z.number().int().describe('Issue number'),
      }),
    },
  );

  const github_search_repos = tool(
    async ({ query }: { query: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const result = await githubRequest(
          account.raw.token as string,
          `/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'github_search_repos failed');
        return `Error searching GitHub repositories: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'github_search_repos',
      description: 'Search GitHub repositories (GitHub search-query syntax, e.g. "org:foo language:ts").',
      schema: z.object({ query: z.string().describe('GitHub search query') }),
    },
  );

  const github_create_issue = tool(
    async ({ owner, repo, title, body }: { owner: string; repo: string; title: string; body?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const issue = await githubRequest(account.raw.token as string, `/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body: body ?? '' }),
        });
        return truncateOutput(JSON.stringify(issue, null, 2), 1000);
      } catch (error) {
        logger.error({ error, owner, repo }, 'github_create_issue failed');
        return `Error creating GitHub issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'github_create_issue',
      description: 'Create a new issue on a GitHub repository. Requires approval.',
      schema: z.object({
        owner: z.string().describe('Repository owner (user or org)'),
        repo: z.string().describe('Repository name'),
        title: z.string().describe('Issue title'),
        body: z.string().optional().describe('Issue body (markdown)'),
      }),
    },
  );

  // Named "create", not "add" — tool-classifier.ts's mutative verb list
  // includes "create" but not "add", so this name is what makes the approval
  // gate actually fire for this write.
  const github_create_comment = tool(
    async ({ owner, repo, issueNumber, body }: { owner: string; repo: string; issueNumber: number; body: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const comment = await githubRequest(
          account.raw.token as string,
          `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) },
        );
        return truncateOutput(JSON.stringify(comment, null, 2), 1000);
      } catch (error) {
        logger.error({ error, owner, repo, issueNumber }, 'github_create_comment failed');
        return `Error creating GitHub comment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'github_create_comment',
      description: 'Add a comment to a GitHub issue or pull request. Requires approval.',
      schema: z.object({
        owner: z.string().describe('Repository owner (user or org)'),
        repo: z.string().describe('Repository name'),
        issueNumber: z.number().int().describe('Issue or pull request number'),
        body: z.string().describe('Comment body (markdown)'),
      }),
    },
  );

  return [github_list_issues, github_get_issue, github_search_repos, github_create_issue, github_create_comment];
}
