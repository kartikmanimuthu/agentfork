/**
 * whatsapp.ts — WhatsApp tool-only integration (Claw Studio agent tools, e.g.
 * `whatsapp_send_message`) via Meta's official Cloud API. Outbound only, by
 * design: no read/receive tools, matching the upstream descriptor this was
 * ported from. Unrelated to `libs/whatsapp`, which is this repo's own
 * WhatsApp *channel* adapter for the core chatbot — do not confuse the two.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { truncateOutput } from '../agent/agent-shared';
import { IntegrationConfigService } from './account-config-service';
import type { IntegrationDescriptor } from './types';

const logger = createLogger('claw-studio:integrations:whatsapp');

const WHATSAPP_API = 'https://graph.facebook.com/v21.0';
const NOT_CONNECTED =
  'WhatsApp is not connected. Connect a Cloud API access token and phone number id in Mission Control → Integrations.';
/** Bounds every call — without this, a stalled Graph API hangs the whole chat turn indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Meta's own text-message body length cap. */
const MAX_TEXT_LENGTH = 4096;

async function whatsappRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${WHATSAPP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const whatsappDescriptor: IntegrationDescriptor = {
  name: 'whatsapp',
  displayName: 'WhatsApp',
  description: "Send WhatsApp messages through Meta's official Cloud API (outbound only).",
  accountMode: 'single',
  authMode: 'manual',
  secretFields: ['accessToken'],
  async verify(fields) {
    const accessToken = fields.accessToken?.trim();
    const phoneNumberId = fields.phoneNumberId?.trim();
    if (!accessToken || !phoneNumberId) {
      return { ok: false, error: 'An access token and a Cloud API phone number id are both required.' };
    }
    try {
      const data = (await whatsappRequest(accessToken, `/${encodeURIComponent(phoneNumberId)}`)) as {
        display_phone_number?: string;
      };
      if (!data.display_phone_number) {
        return { ok: false, error: 'Meta did not return a phone number for this phone number id.' };
      }
      return { ok: true, detail: `Connected as ${data.display_phone_number}`, meta: { displayPhoneNumber: data.display_phone_number } };
    } catch (error) {
      logger.warn({ error }, 'WhatsApp verify failed');
      return { ok: false, error: error instanceof Error ? error.message : 'WhatsApp verification failed' };
    }
  },
};

export function createWhatsappTools(tenantId: string) {
  const configs = new IntegrationConfigService(tenantId, whatsappDescriptor);

  const whatsapp_send_message = tool(
    async ({ to, text }: { to: string; text: string }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const phoneNumberId = account.raw.phoneNumberId as string;
        const result = await whatsappRequest(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: text.slice(0, MAX_TEXT_LENGTH) },
          }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 1000);
      } catch (error) {
        logger.error({ error, to }, 'whatsapp_send_message failed');
        return `Error sending WhatsApp message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'whatsapp_send_message',
      description:
        'Send a free-form WhatsApp text message. Only delivered if the recipient messaged this number within the ' +
        'last 24 hours; outside that window use whatsapp_send_template instead. Requires approval.',
      schema: z.object({
        to: z.string().describe('Recipient phone number in international format, e.g. 15551234567'),
        text: z.string().describe('Message body (truncated to 4096 characters)'),
      }),
    },
  );

  const whatsapp_send_template = tool(
    async ({
      to,
      templateName,
      languageCode = 'en_US',
    }: {
      to: string;
      templateName: string;
      languageCode?: string;
    }) => {
      try {
        const account = await configs.resolveAccount();
        if (!account) return NOT_CONNECTED;
        const accessToken = account.raw.accessToken as string;
        const phoneNumberId = account.raw.phoneNumberId as string;
        const result = await whatsappRequest(accessToken, `/${encodeURIComponent(phoneNumberId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: { name: templateName, language: { code: languageCode } },
          }),
        });
        return truncateOutput(JSON.stringify(result, null, 2), 1000);
      } catch (error) {
        logger.error({ error, to, templateName }, 'whatsapp_send_template failed');
        return `Error sending WhatsApp template message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'whatsapp_send_template',
      description:
        'Send a pre-approved WhatsApp template message — works outside the 24-hour free-form service window, ' +
        'unlike whatsapp_send_message. Requires approval.',
      schema: z.object({
        to: z.string().describe('Recipient phone number in international format, e.g. 15551234567'),
        templateName: z.string().describe('Name of the approved WhatsApp message template'),
        languageCode: z.string().optional().describe('Template language code, defaults to en_US'),
      }),
    },
  );

  return [whatsapp_send_message, whatsapp_send_template];
}
