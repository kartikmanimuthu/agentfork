import { createLogger, EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient } from '@chatbot/whatsapp';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppSendTemplateNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-send-template-executor');

export class WhatsAppSendTemplateNodeExecutor implements NodeExecutor {
  type = 'whatsapp_send_template';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppSendTemplateNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const { channels } = ctx.state;

      const senderId = channels['wa_sender_id'];
      if (!senderId) {
        throw new Error('Missing required channel: wa_sender_id');
      }

      const accountId = channels['wa_account_id'];
      if (!accountId) {
        throw new Error('Missing required channel: wa_account_id');
      }

      const account = await ctx.services.prisma.whatsAppAccount.findUnique({
        where: { id: String(accountId) },
      });
      if (!account) {
        throw new Error(`WhatsAppAccount not found: ${accountId}`);
      }

      const accessToken = new EncryptionService().decrypt(account.accessToken);

      const client = new MetaWhatsAppClient({
        accessToken,
        phoneNumberId: account.phoneNumberId,
        apiVersion: account.apiVersion ?? 'v22.0',
      });

      let components: unknown[] | undefined;
      if (config.componentsChannel) {
        const raw = channels[config.componentsChannel];
        if (Array.isArray(raw)) {
          components = raw;
        } else if (typeof raw === 'string' && raw.length > 0) {
          components = JSON.parse(raw) as unknown[];
        }
      }

      const response = await client.sendTemplateMessage(
        String(senderId),
        config.templateName,
        config.languageCode,
        components as Parameters<typeof client.sendTemplateMessage>[3],
      );

      const sentMessageId = response.messages[0].id;

      logger.info(
        { nodeId: ctx.node.id, templateName: config.templateName, sentMessageId },
        'WhatsApp template message sent',
      );

      return {
        stateUpdates: { wa_last_sent_message_id: sentMessageId },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'whatsapp_send_template',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { templateName: config.templateName, languageCode: config.languageCode },
          output: { sentMessageId },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'WhatsApp send template failed');
      throw error;
    }
  }
}
