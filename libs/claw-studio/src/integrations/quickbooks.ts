/**
 * quickbooks.ts — QuickBooks Online tool-only integration: single-account
 * (one Intuit company per tenant), manual access-token-paste auth. OpenWorker
 * labels this connector `auth="oauth"`, but even its own open-source code
 * never performs a handshake — the user pastes an already-obtained OAuth
 * access token into a form field (the real broker lives in OpenWorker's
 * private cloud, not in the public repo). No refresh is implemented here
 * either, matching that: Intuit tokens expire hourly and must be re-pasted.
 * Read-only, per the connector's own blurb — no write tools.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:quickbooks');

const NOT_CONNECTED =
  'QuickBooks is not connected. Connect an access token and company ID in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled QuickBooks API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Same host-selection logic reused by both `verify()` and every tool call. */
function quickbooksHost(environment?: string): string {
  const env = (environment ?? '').trim().toLowerCase();
  return env.startsWith('sand') ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
}

function quickbooksBase(realmId: string, environment?: string): string {
  return `https://${quickbooksHost(environment)}/v3/company/${encodeURIComponent(realmId)}`;
}

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]);
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

/** Clamps a model-supplied result count into a sane range, mirroring OpenWorker's `_clamp`. */
function clampMaxResults(n: number | undefined, ceiling = 20): number {
  return Math.max(1, Math.min(Math.trunc(n ?? 10), ceiling));
}

async function quickbooksRequest(
  accessToken: string,
  realmId: string,
  environment: string | undefined,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<unknown> {
  const res = await fetch(`${quickbooksBase(realmId, environment)}${path}${buildQuery(params)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`QuickBooks API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const quickbooksDescriptor: IntegrationDescriptor = {
  name: 'quickbooks',
  displayName: 'QuickBooks',
  description: 'Read-only access to customers, invoices, and financial reports.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    const realmId = fields.realmId?.trim();
    const environment = fields.environment?.trim();
    if (!accessToken || !realmId) {
      return { ok: false, error: 'An access token and company ID (realm ID) are required.' };
    }
    try {
      const result = (await quickbooksRequest(
        accessToken,
        realmId,
        environment,
        `/companyinfo/${encodeURIComponent(realmId)}`,
      )) as { CompanyInfo?: { CompanyName?: string } };
      const companyName = result?.CompanyInfo?.CompanyName;
      if (!companyName) {
        return { ok: false, error: 'QuickBooks did not return a company name for this token.' };
      }
      return { ok: true, detail: `Connected to ${companyName}`, meta: { companyName } };
    } catch (error) {
      logger.warn({ error }, 'QuickBooks verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'QuickBooks verification failed' };
    }
  },
};

export function createQuickbooksTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, quickbooksDescriptor);

  const quickbooks_query = tool(
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken, realmId, environment } = account.raw as Record<string, string>;
        let q = query.trim();
        if (!q.toLowerCase().includes('maxresults')) {
          q = `${q} MAXRESULTS ${clampMaxResults(maxResults, 100)}`;
        }
        const result = await quickbooksRequest(accessToken, realmId, environment, '/query', { query: q });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'quickbooks_query failed');
        return `Error running QuickBooks query: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'quickbooks_query',
      description:
        'Run a QuickBooks Online query, e.g. "SELECT * FROM Invoice WHERE TotalAmt > \'100\'". Entities include Customer, Invoice, Bill, Payment, Account, Vendor.',
      schema: z.object({
        query: z.string().describe('QuickBooks Online query language (QBO SQL-like syntax)'),
        maxResults: z.number().int().optional().describe('Max results, defaults to 10 (capped at 100)'),
      }),
    },
  );

  const quickbooks_list_customers = tool(
    async ({ maxResults }: { maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken, realmId, environment } = account.raw as Record<string, string>;
        const result = await quickbooksRequest(accessToken, realmId, environment, '/query', {
          query: `SELECT * FROM Customer MAXRESULTS ${clampMaxResults(maxResults)}`,
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'quickbooks_list_customers failed');
        return `Error listing QuickBooks customers: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'quickbooks_list_customers',
      description: 'List QuickBooks customers.',
      schema: z.object({
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const quickbooks_list_invoices = tool(
    async ({ maxResults }: { maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken, realmId, environment } = account.raw as Record<string, string>;
        const result = await quickbooksRequest(accessToken, realmId, environment, '/query', {
          query: `SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS ${clampMaxResults(maxResults)}`,
        });
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'quickbooks_list_invoices failed');
        return `Error listing QuickBooks invoices: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'quickbooks_list_invoices',
      description: 'List recent QuickBooks invoices.',
      schema: z.object({
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const quickbooks_get_report = tool(
    async ({ report, startDate, endDate }: { report: string; startDate?: string; endDate?: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken, realmId, environment } = account.raw as Record<string, string>;
        const result = await quickbooksRequest(
          accessToken,
          realmId,
          environment,
          `/reports/${encodeURIComponent(report)}`,
          { start_date: startDate, end_date: endDate },
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, report }, 'quickbooks_get_report failed');
        return `Error running QuickBooks report: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'quickbooks_get_report',
      description:
        'Run a QuickBooks report such as ProfitAndLoss, BalanceSheet, CashFlow, AgedReceivables. Dates are YYYY-MM-DD.',
      schema: z.object({
        report: z.string().describe('Report name, e.g. ProfitAndLoss, BalanceSheet, CashFlow, AgedReceivables'),
        startDate: z.string().optional().describe('Report start date, YYYY-MM-DD'),
        endDate: z.string().optional().describe('Report end date, YYYY-MM-DD'),
      }),
    },
  );

  return [quickbooks_query, quickbooks_list_customers, quickbooks_list_invoices, quickbooks_get_report];
}
