import type {
  TelegramApiResponse,
  TelegramGetMeResult,
  TelegramSendMessageResult,
  TelegramSetWebhookResult,
  InlineKeyboardMarkup,
} from '../webhook/types';

export interface TelegramBotApiConfig {
  botToken: string;
  apiBase?: string;
}

export class TelegramBotApi {
  private readonly apiBase: string;
  private readonly botToken: string;

  constructor(config: TelegramBotApiConfig) {
    this.botToken = config.botToken;
    this.apiBase = config.apiBase ?? 'https://api.telegram.org';
  }

  private async request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.apiBase}/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as TelegramApiResponse<T>;

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.error_code} - ${data.description}`);
    }

    return data.result as T;
  }

  async getMe(): Promise<TelegramGetMeResult> {
    return this.request<TelegramGetMeResult>('getMe');
  }

  async setWebhook(url: string, secretToken?: string): Promise<TelegramSetWebhookResult> {
    const body: Record<string, unknown> = { url };
    if (secretToken) {
      body.secret_token = secretToken;
    }
    return this.request<TelegramSetWebhookResult>('setWebhook', body);
  }

  async deleteWebhook(): Promise<{ ok: boolean; result: boolean }> {
    return this.request<{ ok: boolean; result: boolean }>('deleteWebhook');
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    options?: {
      parseMode?: 'Markdown' | 'HTML';
      replyToMessageId?: number;
      replyMarkup?: InlineKeyboardMarkup;
    },
  ): Promise<TelegramSendMessageResult> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (options?.parseMode) {
      body.parse_mode = options.parseMode;
    }
    if (options?.replyToMessageId) {
      body.reply_to_message_id = options.replyToMessageId;
    }
    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }
    return this.request<TelegramSendMessageResult>('sendMessage', body);
  }

  async sendPhoto(
    chatId: string | number,
    photoUrl: string,
    caption?: string,
    options?: {
      parseMode?: 'Markdown' | 'HTML';
      replyToMessageId?: number;
    },
  ): Promise<TelegramSendMessageResult> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo: photoUrl,
    };
    if (caption) {
      body.caption = caption;
    }
    if (options?.parseMode) {
      body.parse_mode = options.parseMode;
    }
    if (options?.replyToMessageId) {
      body.reply_to_message_id = options.replyToMessageId;
    }
    return this.request<TelegramSendMessageResult>('sendPhoto', body);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) {
      body.text = text;
    }
    return this.request<boolean>('answerCallbackQuery', body);
  }

  async editMessageReplyMarkup(
    chatId: string | number,
    messageId: number,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<TelegramSendMessageResult> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    return this.request<TelegramSendMessageResult>('editMessageReplyMarkup', body);
  }
}
