/**
 * email.ts — generic IMAP/SMTP email tool-only integration: single account
 * (an email address + app password), live-connection validation rather than a
 * simple REST call, read tools over IMAP, and one approval-gated send tool
 * over SMTP.
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:email');

const NOT_CONNECTED = 'No email account is connected. Connect one in Mission Control → Integrations.';
const CONNECT_TIMEOUT_MS = 10_000;

/** Pre-fills common providers' server settings — never overrides an explicit host/port the user entered. */
const KNOWN_PROVIDERS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  'gmail.com': { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  'outlook.com': { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  'hotmail.com': { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  'live.com': { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  'yahoo.com': { imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465 },
};

interface ServerConfig {
  imapHost?: string;
  imapPort: number;
  smtpHost?: string;
  smtpPort: number;
}

function resolveServerConfig(fields: Record<string, unknown>): ServerConfig {
  const address = typeof fields.address === 'string' ? fields.address : '';
  const domain = address.split('@')[1]?.toLowerCase();
  const known = domain ? KNOWN_PROVIDERS[domain] : undefined;
  const imapPort = Number(fields.imapPort) || known?.imapPort || 993;
  const smtpPort = Number(fields.smtpPort) || known?.smtpPort || 587;
  return {
    imapHost: (typeof fields.imapHost === 'string' && fields.imapHost.trim()) || known?.imapHost,
    imapPort,
    smtpHost: (typeof fields.smtpHost === 'string' && fields.smtpHost.trim()) || known?.smtpHost,
    smtpPort,
  };
}

/**
 * ImapFlow is an EventEmitter that emits 'error' for anything happening after
 * the initial connect() promise has already settled (e.g. a socket timeout
 * during logout() or a mid-command failure) — see emitError() in imap-flow.js.
 * Node throws (crashing the process) when an 'error' event has no listener,
 * so every client needs one attached, even though the real failure is still
 * surfaced to the caller via the awaited operation rejecting/closing.
 */
function attachErrorLogger(client: ImapFlow): void {
  client.on('error', (error) => {
    logger.warn({ error }, 'IMAP client error');
  });
}

async function withImap<T>(raw: Record<string, unknown>, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const address = raw.address as string;
  const appPassword = raw.appPassword as string;
  const cfg = resolveServerConfig(raw);
  if (!cfg.imapHost) {
    throw new Error('No IMAP host configured or inferred for this email domain — set an explicit IMAP host.');
  }
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: true,
    auth: { user: address, pass: appPassword },
    logger: false,
    socketTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });
  attachErrorLogger(client);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export const emailDescriptor: IntegrationDescriptor = {
  name: 'email',
  displayName: 'Email (IMAP/SMTP)',
  description: 'Search, read, and send email through any IMAP/SMTP mailbox (Gmail, Outlook, custom domains).',
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['appPassword'],
  async verify(fields) {
    const address = fields.address?.trim();
    const appPassword = fields.appPassword?.trim();
    if (!address || !appPassword) {
      return { ok: false, error: 'Email address and app password are required.' };
    }
    const cfg = resolveServerConfig(fields);
    if (!cfg.imapHost) {
      return { ok: false, error: 'Could not determine an IMAP host for this domain — set the advanced IMAP host/port fields.' };
    }
    try {
      const client = new ImapFlow({
        host: cfg.imapHost,
        port: cfg.imapPort,
        secure: true,
        auth: { user: address, pass: appPassword },
        logger: false,
        socketTimeout: CONNECT_TIMEOUT_MS,
        greetingTimeout: CONNECT_TIMEOUT_MS,
      });
      attachErrorLogger(client);
      await client.connect();
      await client.logout().catch(() => client.close());
      return { ok: true, detail: `Connected to ${address}`, meta: { address } };
    } catch (error) {
      logger.warn({ error }, 'Email verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'IMAP login failed' };
    }
  },
};

export function createEmailTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, emailDescriptor);

  const email_search_messages = tool(
    async ({
      from,
      subject,
      sinceDays,
      limit = 10,
    }: {
      from?: string;
      subject?: string;
      sinceDays?: number;
      limit?: number;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const results = await withImap(account.raw, async (client) => {
          await client.mailboxOpen('INBOX', { readOnly: true });
          const query: Record<string, unknown> = {};
          if (from) query.from = from;
          if (subject) query.subject = subject;
          if (sinceDays) query.since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
          if (Object.keys(query).length === 0) query.all = true;

          const uids = await client.search(query, { uid: true });
          if (!uids || uids.length === 0) return [];
          const recent = uids.slice(-limit);
          const messages = await client.fetchAll(recent, { envelope: true }, { uid: true });
          return messages.map((m) => ({
            uid: m.uid,
            subject: m.envelope?.subject ?? '(no subject)',
            from: m.envelope?.from?.map((a) => a.address).join(', ') ?? '',
            date: m.envelope?.date,
          }));
        });
        return truncateOutput(JSON.stringify(results, null, 2), 2000);
      } catch (error) {
        logger.error({ error }, 'email_search_messages failed');
        return `Error searching mailbox: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'email_search_messages',
      description: 'Search the connected mailbox\'s inbox by sender, subject, and/or recency.',
      schema: z.object({
        from: z.string().optional().describe('Filter by sender address/name'),
        subject: z.string().optional().describe('Filter by subject text'),
        sinceDays: z.number().int().optional().describe('Only messages from the last N days'),
        limit: z.number().int().optional().describe('Max results, defaults to 10'),
      }),
    },
  );

  const email_read_message = tool(
    async ({ uid }: { uid: number }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const text = await withImap(account.raw, async (client) => {
          await client.mailboxOpen('INBOX', { readOnly: true });
          const message = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!message || !message.source) return null;
          const parsed = await simpleParser(message.source);
          return { subject: parsed.subject, from: parsed.from?.text, date: parsed.date, body: parsed.text || parsed.html };
        });
        if (!text) return `No message found with uid ${uid}.`;
        return truncateOutput(JSON.stringify(text, null, 2), 3000);
      } catch (error) {
        logger.error({ error, uid }, 'email_read_message failed');
        return `Error reading message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'email_read_message',
      description: 'Read the full body of a message by its uid (from email_search_messages results).',
      schema: z.object({ uid: z.number().int().describe('Message uid') }),
    },
  );

  const email_send_message = tool(
    async ({ to, subject, body }: { to: string; subject: string; body: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const cfg = resolveServerConfig(account.raw);
        if (!cfg.smtpHost) {
          return 'Error sending email: could not determine an SMTP host for this domain — set the advanced SMTP host/port fields.';
        }
        const address = account.raw.address as string;
        const transport = nodemailer.createTransport({
          host: cfg.smtpHost,
          port: cfg.smtpPort,
          secure: cfg.smtpPort === 465,
          auth: { user: address, pass: account.raw.appPassword as string },
          connectionTimeout: CONNECT_TIMEOUT_MS,
        });
        const info = await transport.sendMail({ from: address, to, subject, text: body });
        return `Sent. Message id: ${info.messageId}`;
      } catch (error) {
        logger.error({ error, to }, 'email_send_message failed');
        return `Error sending email: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'email_send_message',
      description: 'Send an email from the connected mailbox. Requires approval.',
      schema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
      }),
    },
  );

  return [email_search_messages, email_read_message, email_send_message];
}
