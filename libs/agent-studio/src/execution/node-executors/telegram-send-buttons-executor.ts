import { createLogger, EncryptionService } from '@chatbot/shared';
import { TelegramBotApi } from '@chatbot/telegram';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { TelegramSendButtonsNodeConfig } from '../../types/nodes';
import type { InlineKeyboardMarkup } from '@chatbot/telegram';

const logger = createLogger('agent-studio:telegram-send-buttons-executor');

export class TelegramSendButtonsNodeExecutor implements NodeExecutor {
  type = 'telegram_send_buttons';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as TelegramSendButtonsNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const { channels } = ctx.state;

      const chatId = channels['tg_chat_id'];
      if (!chatId) throw new Error('Missing required channel: tg_chat_id');

      const accountId = channels['tg_account_id'];
      if (!accountId) throw new Error('Missing required channel: tg_account_id');

      const account = await (ctx.services.prisma as any).telegramAccount.findUnique({
        where: { id: String(accountId) },
      });
      if (!account) throw new Error(`TelegramAccount not found: ${accountId}`);

      const botToken = new EncryptionService().decrypt(account.botToken);
      const client = new TelegramBotApi({ botToken });

      const messageContent = channels[config.messageChannel];
      if (messageContent == null || messageContent === '') {
        throw new Error(`Message channel "${config.messageChannel}" is empty`);
      }

      const replyMarkup = this.buildReplyMarkup(config, channels);

      const response = await client.sendMessage(String(chatId), String(messageContent), {
        parseMode: config.parseMode,
        replyMarkup,
      });

      const sentMessageId = String(response.message_id);

      logger.info({ nodeId: ctx.node.id, sentMessageId }, 'Telegram buttons message sent');

      return {
        stateUpdates: { tg_last_sent_message_id: sentMessageId },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'telegram_send_buttons',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { chatId, messageChannel: config.messageChannel },
          output: { sentMessageId },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'Telegram send buttons failed');
      throw error;
    }
  }

  private buildReplyMarkup(
    config: TelegramSendButtonsNodeConfig,
    channels: Record<string, unknown>,
  ): InlineKeyboardMarkup | undefined {
    let buttons = config.buttons;

    if (config.buttonsChannel) {
      const dynamicButtons = channels[config.buttonsChannel];
      if (Array.isArray(dynamicButtons) && dynamicButtons.length > 0) {
        buttons = dynamicButtons as typeof buttons;
      }
    }

    if (!buttons.length) return undefined;

    // buttons is Array<Array<{text, callbackData}>> — each inner array is a row
    return {
      inline_keyboard: buttons.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.callbackData }))
      ),
    };
  }
}
