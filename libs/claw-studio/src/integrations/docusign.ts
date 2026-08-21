/**
 * docusign.ts — Docusign tool-only integration: single-account, manual
 * access-token-paste auth. OpenWorker labels this connector `auth="oauth"`,
 * but even its own open-source code never performs a handshake — the user
 * pastes an already-obtained access token (JWT or authorization-code grant)
 * into a form field (the real broker lives in OpenWorker's private cloud, not
 * in the public repo).
 *
 * Docusign's API is multi-region, so the account-scoped base URL isn't fixed
 * — it's discovered per token from the OAuth userinfo endpoint's `accounts[]`
 * (`account_id` + `base_uri`). `verify()` only needs the identity (`email`),
 * so it doesn't fetch or cache that; every tool call re-resolves it fresh via
 * `resolveDocusignContext`, mirroring OpenWorker's `_docusign_ctx` helper.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:docusign');

const NOT_CONNECTED = 'Docusign is not connected. Connect an access token in Mission Control → Integrations.';
const DOCUSIGN_USERINFO_URL = 'https://account.docusign.com/oauth/userinfo';
/** Bounds every call — without this, a stalled Docusign API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

interface DocusignUserInfoAccount {
  account_id?: string;
  base_uri?: string;
  is_default?: boolean;
}

interface DocusignUserInfo {
  email?: string;
  accounts?: DocusignUserInfoAccount[];
}

async function docusignUserInfo(accessToken: string): Promise<DocusignUserInfo> {
  const res = await fetch(DOCUSIGN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Docusign API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

interface DocusignContext {
  accessToken: string;
  /** `{base_uri}/restapi/v2.1/accounts/{account_id}` — the account-scoped API root. */
  baseUrl: string;
}

/**
 * Resolves the account-scoped API root from the OAuth userinfo endpoint,
 * mirroring OpenWorker's `_docusign_ctx`. Re-fetched on every tool call
 * rather than persisted alongside the stored account — userinfo is cheap,
 * and `verify()` deliberately doesn't cache `account_id`/`base_uri` at
 * connect time (see module docstring).
 */
async function resolveDocusignContext(accessToken: string): Promise<DocusignContext> {
  const info = await docusignUserInfo(accessToken);
  const accounts = info.accounts ?? [];
  const chosen = accounts.find((a) => a.is_default) ?? accounts[0];
  if (!chosen?.account_id || !chosen.base_uri) {
    throw new Error('Docusign token has no associated accounts.');
  }
  return {
    accessToken,
    baseUrl: `${chosen.base_uri.replace(/\/+$/, '')}/restapi/v2.1/accounts/${chosen.account_id}`,
  };
}

function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]);
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

async function docusignRequest(ctx: DocusignContext, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Docusign API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const docusignDescriptor: IntegrationDescriptor = {
  name: 'docusign',
  displayName: 'Docusign',
  description: 'Track agreements, check envelope status, and send documents for signature.',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    if (!accessToken) return { ok: false, error: 'An access token is required.' };
    try {
      const info = await docusignUserInfo(accessToken);
      if (!info.email) {
        return { ok: false, error: 'Docusign did not return an email for this token.' };
      }
      return { ok: true, detail: `Connected as ${info.email}`, meta: { email: info.email } };
    } catch (error) {
      logger.warn({ error }, 'Docusign verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'Docusign verification failed' };
    }
  },
};

export function createDocusignTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, docusignDescriptor);

  const docusign_list_envelopes = tool(
    async ({ status, sinceDays = 30 }: { status?: string; sinceDays?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken } = account.raw as Record<string, string>;
        const ctx = await resolveDocusignContext(accessToken);
        const fromDate = new Date(Date.now() - Math.max(1, Math.trunc(sinceDays)) * 24 * 60 * 60 * 1000)
          .toISOString()
          .replace(/\.\d+Z$/, 'Z');
        const result = await docusignRequest(ctx, `/envelopes${buildQuery({ from_date: fromDate, status })}`);
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, status, sinceDays }, 'docusign_list_envelopes failed');
        return `Error listing Docusign envelopes: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'docusign_list_envelopes',
      description: 'List recent Docusign envelopes, optionally by status (sent/delivered/completed/declined/voided).',
      schema: z.object({
        status: z.string().optional().describe('Envelope status filter, e.g. sent, delivered, completed, declined, voided'),
        sinceDays: z.number().int().optional().describe('How many days back to look, defaults to 30'),
      }),
    },
  );

  const docusign_get_envelope = tool(
    async ({ envelopeId }: { envelopeId: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken } = account.raw as Record<string, string>;
        const ctx = await resolveDocusignContext(accessToken);
        const result = await docusignRequest(
          ctx,
          `/envelopes/${encodeURIComponent(envelopeId)}${buildQuery({ include: 'recipients' })}`,
        );
        return truncateOutput(JSON.stringify(result, null, 2), 2000);
      } catch (error) {
        logger.error({ error, envelopeId }, 'docusign_get_envelope failed');
        return `Error fetching Docusign envelope: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'docusign_get_envelope',
      description: "Read a Docusign envelope's status and per-signer progress.",
      schema: z.object({
        envelopeId: z.string().describe('Docusign envelope id'),
      }),
    },
  );

  const docusign_list_templates = tool(
    async ({ maxResults = 10 }: { maxResults?: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken } = account.raw as Record<string, string>;
        const ctx = await resolveDocusignContext(accessToken);
        const count = Math.max(1, Math.min(Math.trunc(maxResults), 20));
        const result = await docusignRequest(ctx, `/templates${buildQuery({ count: String(count) })}`);
        return truncateOutput(JSON.stringify(result, null, 2), 1500);
      } catch (error) {
        logger.error({ error }, 'docusign_list_templates failed');
        return `Error listing Docusign templates: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'docusign_list_templates',
      description: 'List Docusign templates (template ids are needed to send).',
      schema: z.object({
        maxResults: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const docusign_send_from_template = tool(
    async ({
      templateId,
      recipientEmail,
      recipientName,
      roleName = 'Signer',
      subject,
    }: {
      templateId: string;
      recipientEmail: string;
      recipientName: string;
      roleName?: string;
      subject?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const { accessToken } = account.raw as Record<string, string>;
        const ctx = await resolveDocusignContext(accessToken);
        const result = await docusignRequest(ctx, '/envelopes', {
          method: 'POST',
          body: JSON.stringify({
            templateId,
            templateRoles: [{ email: recipientEmail, name: recipientName, roleName }],
            status: 'sent',
            ...(subject ? { emailSubject: subject } : {}),
          }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 1000);
      } catch (error) {
        logger.error({ error, templateId }, 'docusign_send_from_template failed');
        return `Error sending Docusign envelope from template: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'docusign_send_from_template',
      description: 'Send a Docusign template to one signer for signature. Requires approval.',
      schema: z.object({
        templateId: z.string().describe('Docusign template id'),
        recipientEmail: z.string().describe('Signer email address'),
        recipientName: z.string().describe('Signer display name'),
        roleName: z.string().optional().describe('Template role name, defaults to "Signer"'),
        subject: z.string().optional().describe('Email subject line for the signature request'),
      }),
    },
  );

  return [docusign_list_envelopes, docusign_get_envelope, docusign_list_templates, docusign_send_from_template];
}
