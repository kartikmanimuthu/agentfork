import { createLogger, EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient } from '@chatbot/whatsapp';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppSendNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-send-executor');

export class WhatsAppSendNodeExecutor implements NodeExecutor {
  type = 'whatsapp_send';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppSendNodeConfig;
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

      const messageContent = channels[config.messageChannel];
      if (messageContent == null || messageContent === '') {
        throw new Error(`Message channel "${config.messageChannel}" is empty`);
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

      const to = String(senderId);
      let sentMessageId: string;

      if (config.messageType === 'text') {
        const response = await client.sendTextMessage(to, String(messageContent));
        sentMessageId = response.messages[0].id;
      } else if (config.messageType === 'image') {
        const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
        const caption = String(messageContent);
        const response = await client.sendImageMessage(to, mediaId, caption);
        sentMessageId = response.messages[0].id;
      } else if (config.messageType === 'document') {
        const mediaId = String(channels[config.mediaIdChannel ?? ''] ?? '');
        const filename = config.filenameChannel ? String(channels[config.filenameChannel] ?? '') : undefined;
        const caption = String(messageContent);
        const response = await client.sendDocumentMessage(to, mediaId, filename, caption);
        sentMessageId = response.messages[0].id;
      } else {
        throw new Error(`Unsupported messageType: ${config.messageType}`);
      }

      logger.info(
        { nodeId: ctx.node.id, messageType: config.messageType, sentMessageId },
        'WhatsApp message sent',
      );

      return {
        stateUpdates: { wa_last_sent_message_id: sentMessageId },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'whatsapp_send',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { messageType: config.messageType, messageChannel: config.messageChannel },
          output: { sentMessageId },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'WhatsApp send failed');
      throw error;
    }
  }
}
