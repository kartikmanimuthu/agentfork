/**
 * posthog.ts — PostHog tool-only integration: multi-account (one row per
 * connected project, keyed by the `projectId` field itself — PostHog's
 * whoami endpoint returns no project id, only the user's own identity, so
 * unlike HubSpot the account key comes from the credential the user typed,
 * not from the verify response body), personal-API-key auth
 * (`Authorization: Bearer <apiKey>`), read-only HogQL query + insight tools.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:posthog');

const NOT_CONNECTED = 'PostHog is not connected. Connect a personal API key in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled PostHog API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Falls back to US cloud when no EU/self-hosted baseUrl is configured, matching OpenWorker's `_posthog_base`. */
function posthogBase(baseUrl?: string): string {
  return (baseUrl?.trim() || 'https://us.posthog.com').replace(/\/+$/, '');
}

async function posthogRequest(apiKey: string, baseUrl: string | undefined, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${posthogBase(baseUrl)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostHog API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const posthogDescriptor: IntegrationDescriptor = {
  name: 'posthog',
  displayName: 'PostHog',
  description: 'Query product analytics: events, funnels, saved insights.',
  accountMode: 'multi',
  authMode: 'manual',
  secretFields: ['apiKey'],
  async verify(fields) {
    const apiKey = fields.apiKey?.trim();
    if (!apiKey) return { ok: false, error: 'A personal API key is required.' };
    const projectId = fields.projectId?.trim();
    if (!projectId) return { ok: false, error: 'A project ID is required.' };
    try {
      const me = (await posthogRequest(apiKey, fields.baseUrl, '/api/users/@me/')) as { email?: string };
      return {
        ok: true,
        detail: me.email ? `Connected as ${me.email} (project ${projectId})` : `Connected to project ${projectId}`,
        meta: { accountId: projectId, label: me.email ? `${me.email} (project ${projectId})` : `Project ${projectId}` },
      };
    } catch (error) {
      logger.warn({ error }, 'PostHog verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'PostHog verification failed' };
    }
  },
};

export function createPosthogTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, posthogDescriptor);

  const posthog_query = tool(
    async ({ hogql, account }: { hogql: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { apiKey: apiKey, baseUrl: baseUrl, projectId: projectId } = resolved.raw as Record<string, string>;
        const result = await posthogRequest(apiKey, baseUrl, `/api/projects/${encodeURIComponent(projectId)}/query`, {
          method: 'POST',
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'posthog_query failed');
        return `Error running PostHog query: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'posthog_query',
      description:
        'Run a HogQL (SQL-like) query against PostHog analytics, e.g. SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event.',
      schema: z.object({
        hogql: z.string().describe('HogQL query to run'),
        account: z.string().optional().describe('PostHog project account id or label; omit for the default connected project'),
      }),
    },
  );

  const posthog_list_insights = tool(
    async ({ query, maxResults = 10, account }: { query?: string; maxResults?: number; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const { apiKey: apiKey, baseUrl: baseUrl, projectId: projectId } = resolved.raw as Record<string, string>;
        const params = new URLSearchParams({ limit: String(maxResults) });
        if (query) params.set('search', query);
        const result = await posthogRequest(
          apiKey,
          baseUrl,
          `/api/projects/${encodeURIComponent(projectId)}/insights?${params.toString()}`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'posthog_list_insights failed');
        return `Error listing PostHog insights: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'posthog_list_insights',
      description: "List saved PostHog insights (dashboards' building blocks).",
      schema: z.object({
        query: z.string().optional().describe('Free-text search filter'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
        account: z.string().optional().describe('PostHog project account id or label; omit for the default connected project'),
      }),
    },
  );

  return [posthog_query, posthog_list_insights];
}
