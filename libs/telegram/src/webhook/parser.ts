import type { TelegramWebhookEvent, TelegramUpdate } from './types';

export function parseWebhookBody(body: TelegramUpdate): TelegramWebhookEvent | null {
  const update = body;

  const message = update.message ?? update.edited_message ?? update.channel_post;
  const callbackQuery = update.callback_query;

  if (!message && !callbackQuery) {
    return null;
  }

  if (callbackQuery) {
    const msg = callbackQuery.message;
    const chat = msg?.chat;
    const from = callbackQuery.from;

    if (!chat) return null;

    return {
      updateId: update.update_id,
      type: 'callback_query',
      chatId: String(chat.id),
      fromId: String(from.id),
      fromName: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unknown',
      callbackData: callbackQuery.data,
      callbackQueryId: callbackQuery.id,
      isGroup: chat.type === 'group' || chat.type === 'supergroup',
      rawUpdate: update as unknown as Record<string, unknown>,
    };
  }

  if (message) {
    const chat = message.chat;
    const from = message.from;

    if (!from) return null;

    const text = message.text ?? message.caption ?? '';
    const entities = message.entities ?? [];
    const botUsername = entities
      .filter((e) => e.type === 'mention')
      .map((e) => text.slice(e.offset, e.offset + e.length))
      .find((m) => m.startsWith('@'));

    return {
      updateId: update.update_id,
      type: update.edited_message ? 'edited_message' : update.channel_post ? 'channel_post' : 'message',
      chatId: String(chat.id),
      fromId: String(from.id),
      fromName: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unknown',
      text,
      photoUrls: message.photo?.map((p) => p.file_id),
      document: message.document
        ? {
            fileName: message.document.file_name,
            mimeType: message.document.mime_type,
            fileId: message.document.file_id,
          }
        : undefined,
      isGroup: chat.type === 'group' || chat.type === 'supergroup',
      botUsername,
      rawUpdate: update as unknown as Record<string, unknown>,
    };
  }

  return null;
}
