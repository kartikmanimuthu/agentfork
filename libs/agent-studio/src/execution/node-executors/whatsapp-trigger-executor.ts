import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppTriggerNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-trigger-executor');

export class WhatsAppTriggerNodeExecutor implements NodeExecutor {
  type = 'whatsapp_trigger';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppTriggerNodeConfig;
    const startedAt = new Date().toISOString();
    const { channels } = ctx.state;

    const senderId = channels['wa_sender_id'];
    const phoneNumberId = channels['wa_phone_number_id'];

    if (!senderId) throw new Error('WhatsApp Trigger: wa_sender_id is missing from state — this node must be started via the WhatsApp webhook');
    if (!phoneNumberId) throw new Error('WhatsApp Trigger: wa_phone_number_id is missing from state — this node must be started via the WhatsApp webhook');

    const updates: Record<string, unknown> = {
      wa_sender_id: senderId,
      wa_message_text: channels['wa_message_text'] ?? '',
      wa_message_type: channels['wa_message_type'] ?? 'text',
      wa_media_id: channels['wa_media_id'] ?? null,
      wa_phone_number_id: phoneNumberId,
      wa_account_id: channels['wa_account_id'] ?? null,
      wa_session_id: channels['wa_session_id'] ?? null,
      wa_within_window: channels['wa_within_window'] ?? false,
    };

    if (config.channelMap) {
      const map = config.channelMap;
      if (map.senderIdChannel) updates[map.senderIdChannel] = senderId;
      if (map.messageTextChannel) updates[map.messageTextChannel] = updates['wa_message_text'];
      if (map.messageTypeChannel) updates[map.messageTypeChannel] = updates['wa_message_type'];
      if (map.mediaIdChannel) updates[map.mediaIdChannel] = updates['wa_media_id'];
      if (map.withinWindowChannel) updates[map.withinWindowChannel] = updates['wa_within_window'];
    }

    logger.info({ nodeId: ctx.node.id, senderId, messageType: updates['wa_message_type'] }, 'WhatsApp trigger processed');

    return {
      stateUpdates: updates,
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'whatsapp_trigger',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { senderId, messageType: updates['wa_message_type'] },
        output: { channelsWritten: Object.keys(updates) },
      },
    };
  }
}
