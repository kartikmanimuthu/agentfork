/**
 * jira.ts — Jira Cloud tool-only integration: multi-account (one row per
 * connected site, keyed by the site domain `verify()` returns), API-token
 * auth, read tools for issues/projects and approval-gated write tools for
 * creating issues and adding comments.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:jira');

const NOT_CONNECTED = 'Jira is not connected. Connect a site + API token in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Jira API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

function siteBaseUrl(site: string): string {
  const trimmed = site.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return trimmed.includes('.') ? `https://${trimmed}` : `https://${trimmed}.atlassian.net`;
}

/** Jira Cloud's issue/comment bodies are Atlassian Document Format, not plain strings. */
function toAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

async function jiraRequest(
  site: string,
  email: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const basic = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const res = await fetch(`${siteBaseUrl(site)}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Jira localizes error messages to the token owner's language preference,
      // and those messages are returned verbatim to the model as the tool
      // result. A malformed-JQL 400 came back in Chinese, which the model could
      // not read well enough to correct its own query, so the run stalled on an
      // error that says exactly what to fix. Pin the response language.
      'Accept-Language': 'en-US',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const jiraDescriptor: IntegrationDescriptor = {
  name: 'jira',
  displayName: 'Jira',
  description: 'Search and create issues, and add comments, in your Jira site.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['apiToken'],
  async verify(fields) {
    const site = fields.site?.trim();
    const email = fields.email?.trim();
    const apiToken = fields.apiToken?.trim();
    if (!site || !email || !apiToken) {
      return { ok: false, error: 'Site, email, and API token are all required.' };
    }
    try {
      const me = (await jiraRequest(site, email, apiToken, '/rest/api/3/myself')) as {
        accountId?: string;
        displayName?: string;
      };
      if (!me.accountId) {
        return { ok: false, error: 'Jira did not return an account id for this token.' };
      }
      const host = siteBaseUrl(site).replace(/^https?:\/\//, '');
      const accountId = `jira-${host}`;
      return {
        ok: true,
        detail: `Connected to ${host} as ${me.displayName ?? email}`,
        meta: { accountId, label: host, site: host, email },
      };
    } catch (error) {
      logger.warn({ error }, 'Jira verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Jira verification failed' };
    }
  },
};

export function createJiraTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, jiraDescriptor);

  const jira_search_issues = tool(
    async ({ jql, account, maxResults = 10 }: { jql: string; account?: string; maxResults?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { site, email, apiToken } = resolved.raw as Record<string, string>;
        // Atlassian removed the classic /rest/api/3/search endpoint (410 Gone) —
        // /rest/api/3/search/jql is its replacement, same request/response shape.
        const result = await jiraRequest(site, email, apiToken, '/rest/api/3/search/jql', {
          method: 'POST',
          body: JSON.stringify({
            jql,
            maxResults,
            fields: ['summary', 'status', 'assignee', 'issuetype', 'priority'],
          }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, jql }, 'jira_search_issues failed');
        return `Error searching Jira issues: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'jira_search_issues',
      // Spelling the common queries out is load-bearing. Asked for "my assigned
      // Jira issues", the model sent a bare issue key as the whole query and got
      // a 400 back — every JQL clause needs a field and an operator, and nothing
      // here said so or showed it what "mine" translates to.
      description: [
        'Search Jira issues using JQL (Jira Query Language).',
        'Every clause needs a field, an operator and a value — a bare issue key like "DEV-137" is not valid JQL.',
        'Common queries: issues assigned to you = "assignee = currentUser()";',
        'your open issues = "assignee = currentUser() AND statusCategory != Done";',
        'one specific issue = "key = DEV-137" (or use jira_get_issue instead);',
        'a project\'s issues = "project = DEV ORDER BY created DESC".',
      ].join(' '),
      schema: z.object({
        jql: z
          .string()
          .describe(
            'JQL query, e.g. "assignee = currentUser() AND statusCategory != Done" or "project = ENG AND status = \\"In Progress\\""',
          ),
        account: z.string().optional().describe('Jira site host or label; omit for the default connected site'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const jira_get_issue = tool(
    async ({ issueKey, account }: { issueKey: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { site, email, apiToken } = resolved.raw as Record<string, string>;
        const issue = await jiraRequest(site, email, apiToken, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
        return truncateOutput(JSON.stringify(issue, null, 2), 2500);
      } catch (error) {
        logger.error({ error, issueKey }, 'jira_get_issue failed');
        return `Error fetching Jira issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'jira_get_issue',
      description: 'Get a single Jira issue by its key (e.g. ENG-123).',
      schema: z.object({
        issueKey: z.string().describe('Jira issue key, e.g. ENG-123'),
        account: z.string().optional().describe('Jira site host or label; omit for the default connected site'),
      }),
    },
  );

  const jira_list_projects = tool(
    async ({ account }: { account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { site, email, apiToken } = resolved.raw as Record<string, string>;
        const result = await jiraRequest(site, email, apiToken, '/rest/api/3/project/search?maxResults=50');
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'jira_list_projects failed');
        return `Error listing Jira projects: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'jira_list_projects',
      description: 'List Jira projects on the connected site — use this to find valid project keys before creating an issue.',
      schema: z.object({
        account: z.string().optional().describe('Jira site host or label; omit for the default connected site'),
      }),
    },
  );

  const jira_create_issue = tool(
    async ({
      projectKey,
      summary,
      description,
      issueType = 'Task',
      account,
    }: {
      projectKey: string;
      summary: string;
      description?: string;
      issueType?: string;
      account?: string;
    }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { site, email, apiToken } = resolved.raw as Record<string, string>;
        const created = await jiraRequest(site, email, apiToken, '/rest/api/3/issue', {
          method: 'POST',
          body: JSON.stringify({
            fields: {
              project: { key: projectKey },
              summary,
              issuetype: { name: issueType },
              ...(description ? { description: toAdf(description) } : {}),
            },
          }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 1000);
      } catch (error) {
        logger.error({ error, projectKey }, 'jira_create_issue failed');
        return `Error creating Jira issue: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'jira_create_issue',
      description: 'Create a new Jira issue. Requires approval.',
      schema: z.object({
        projectKey: z.string().describe('Jira project key, e.g. ENG'),
        summary: z.string().describe('Issue summary/title'),
        description: z.string().optional().describe('Issue description'),
        issueType: z.string().optional().describe('Issue type name, e.g. Task, Bug, Story — defaults to Task'),
        account: z.string().optional().describe('Jira site host or label; omit for the default connected site'),
      }),
    },
  );

  const jira_add_comment = tool(
    async ({ issueKey, comment, account }: { issueKey: string; comment: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { site, email, apiToken } = resolved.raw as Record<string, string>;
        const created = await jiraRequest(site, email, apiToken, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
          method: 'POST',
          body: JSON.stringify({ body: toAdf(comment) }),
        });
        return truncateOutput(JSON.stringify(created, null, 2), 800);
      } catch (error) {
        logger.error({ error, issueKey }, 'jira_add_comment failed');
        return `Error adding Jira comment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'jira_add_comment',
      description: 'Add a comment to a Jira issue. Requires approval.',
      schema: z.object({
        issueKey: z.string().describe('Jira issue key, e.g. ENG-123'),
        comment: z.string().describe('Comment body'),
        account: z.string().optional().describe('Jira site host or label; omit for the default connected site'),
      }),
    },
  );

  return [jira_search_issues, jira_get_issue, jira_list_projects, jira_create_issue, jira_add_comment];
}
