/**
 * gmail.ts — Gmail tool-only integration: OAuth via the shared Google provider
 * (see oauth-providers/google.ts), multi-account (one row per connected
 * mailbox), read tools for searching/reading messages and an approval-gated
 * write tool for sending one.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import { verifyViaIdentify } from './oauth-broker';
import { createGoogleOAuthProvider } from './oauth-providers/google';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:gmail');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const NOT_CONNECTED = 'Gmail is not connected. Connect a mailbox in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Gmail API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
}

async function gmailRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(part: GmailMessagePart | undefined): string {
  if (!part) return '';
  if (part.body?.data) return decodeBase64Url(part.body.data);
  const parts = part.parts ?? [];
  const plain = parts.find((p) => p.mimeType === 'text/plain');
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = parts.find((p) => p.mimeType === 'text/html');
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  for (const nested of parts) {
    const text = extractBody(nested);
    if (text) return text;
  }
  return '';
}

function encodeBase64Url(text: string): string {
  return Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const gmailOAuthProvider = createGoogleOAuthProvider([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]);

export const gmailDescriptor: IntegrationDescriptor = {
  name: 'gmail',
  displayName: 'Gmail',
  description: 'Search, read, and send Gmail messages.',
  accountMode: 'multi',
  authMode: 'oauth',
  secretFields: ['accessToken', 'refreshToken'],
  verify: verifyViaIdentify(gmailOAuthProvider),
  oauth: gmailOAuthProvider,
};

export function createGmailTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, gmailDescriptor);

  const gmail_search_messages = tool(
    async ({ query, account, limit = 10 }: { query: string; account?: string; limit?: number }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const list = (await gmailRequest(accessToken, `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`)) as {
          messages?: Array<{ id: string }>;
        };
        const ids = (list.messages ?? []).map((m) => m.id);
        const messages = (await Promise.all(
          ids.map((id) => gmailRequest(accessToken, `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)),
        )) as GmailMessage[];

        const results = messages.map((m) => ({
          id: m.id,
          subject: headerValue(m.payload?.headers, 'Subject'),
          from: headerValue(m.payload?.headers, 'From'),
          date: headerValue(m.payload?.headers, 'Date'),
          snippet: m.snippet,
        }));
        return truncateOutput(JSON.stringify(results, null, 2), 2000);
      } catch (error) {
        logger.error({ error, query }, 'gmail_search_messages failed');
        return `Error searching Gmail: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gmail_search_messages',
      description: 'Search Gmail using Gmail\'s search syntax (e.g. "from:x@y.com is:unread newer_than:7d").',
      schema: z.object({
        query: z.string().describe('Gmail search query'),
        account: z.string().optional().describe('Connected mailbox email or label; omit for the default connected mailbox'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const gmail_get_message = tool(
    async ({ messageId, account }: { messageId: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const message = (await gmailRequest(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`)) as GmailMessage;
        const body = extractBody(message.payload);
        return truncateOutput(
          JSON.stringify(
            {
              subject: headerValue(message.payload?.headers, 'Subject'),
              from: headerValue(message.payload?.headers, 'From'),
              date: headerValue(message.payload?.headers, 'Date'),
              body,
            },
            null,
            2,
          ),
          3000,
        );
      } catch (error) {
        logger.error({ error, messageId }, 'gmail_get_message failed');
        return `Error reading Gmail message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gmail_get_message',
      description: 'Read the full body of a Gmail message by its id (from gmail_search_messages results).',
      schema: z.object({
        messageId: z.string().describe('Gmail message id'),
        account: z.string().optional().describe('Connected mailbox email or label; omit for the default connected mailbox'),
      }),
    },
  );

  const gmail_send_message = tool(
    async ({ to, subject, body, account }: { to: string; subject: string; body: string; account?: string }) => {
      try {
        const resolved = await configs.resolveAccount(account);
        if (!resolved) return NOT_CONNECTED;
        const accessToken = resolved.raw.accessToken as string;

        const raw = ['To: ' + to, 'Subject: ' + subject, 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
        const sent = (await gmailRequest(accessToken, '/messages/send', {
          method: 'POST',
          body: JSON.stringify({ raw: encodeBase64Url(raw) }),
        })) as { id?: string };
        return `Sent. Message id: ${sent.id}`;
      } catch (error) {
        logger.error({ error, to }, 'gmail_send_message failed');
        return `Error sending Gmail message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'gmail_send_message',
      description: 'Send an email from the connected Gmail mailbox. Requires approval.',
      schema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        account: z.string().optional().describe('Connected mailbox email or label; omit for the default connected mailbox'),
      }),
    },
  );

  return [gmail_search_messages, gmail_get_message, gmail_send_message];
}
