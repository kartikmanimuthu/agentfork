import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { TelegramTriggerNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:telegram-trigger-executor');

export class TelegramTriggerNodeExecutor implements NodeExecutor {
  type = 'telegram_trigger';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as TelegramTriggerNodeConfig;
    const startedAt = new Date().toISOString();
    const { channels } = ctx.state;

    const chatId = channels['tg_chat_id'];
    const accountId = channels['tg_account_id'];

    if (!chatId) throw new Error('Telegram Trigger: tg_chat_id is missing from state');
    if (!accountId) throw new Error('Telegram Trigger: tg_account_id is missing from state');

    const updates: Record<string, unknown> = {
      tg_chat_id: chatId,
      tg_text: channels['tg_text'] ?? '',
      tg_message_type: channels['tg_message_type'] ?? 'text',
      tg_media_id: channels['tg_media_id'] ?? null,
      tg_callback_data: channels['tg_callback_data'] ?? null,
      tg_from_id: channels['tg_from_id'] ?? '',
      tg_from_name: channels['tg_from_name'] ?? '',
      tg_account_id: accountId,
      tg_session_id: channels['tg_session_id'] ?? null,
      tg_is_group: channels['tg_is_group'] ?? false,
    };

    if (config.channelMap) {
      const map = config.channelMap;
      if (map.chatIdChannel) updates[map.chatIdChannel] = chatId;
      if (map.textChannel) updates[map.textChannel] = updates['tg_text'];
      if (map.messageTypeChannel) updates[map.messageTypeChannel] = updates['tg_message_type'];
      if (map.mediaIdChannel) updates[map.mediaIdChannel] = updates['tg_media_id'];
      if (map.callbackDataChannel) updates[map.callbackDataChannel] = updates['tg_callback_data'];
      if (map.fromNameChannel) updates[map.fromNameChannel] = updates['tg_from_name'];
      if (map.isGroupChannel) updates[map.isGroupChannel] = updates['tg_is_group'];
    }

    logger.info({ nodeId: ctx.node.id, chatId, messageType: updates['tg_message_type'] }, 'Telegram trigger processed');

    return {
      stateUpdates: updates,
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'telegram_trigger',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { chatId, messageType: updates['tg_message_type'] },
        output: { channelsWritten: Object.keys(updates) },
      },
    };
  }
}
