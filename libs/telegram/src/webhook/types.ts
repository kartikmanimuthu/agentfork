export interface TelegramWebhookEvent {
  updateId: number;
  type: 'message' | 'callback_query' | 'edited_message' | 'channel_post';
  chatId: string;
  fromId: string;
  fromName: string;
  text?: string;
  photoUrls?: string[];
  document?: { fileName?: string; mimeType?: string; fileId: string };
  callbackData?: string;
  callbackQueryId?: string;
  isGroup: boolean;
  botUsername?: string;
  accountId?: string;
  rawUpdate: Record<string, unknown>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  channel_post?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  entities?: TelegramMessageEntity[];
  caption?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export interface TelegramGetMeResult {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramSendMessageResult {
  message_id: number;
  date: number;
  chat: TelegramChat;
}

export interface TelegramSetWebhookResult {
  ok: boolean;
  result: boolean;
  description?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}
