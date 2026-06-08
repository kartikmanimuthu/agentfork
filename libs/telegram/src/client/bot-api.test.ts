import { describe, it, expect, vi } from 'vitest';
import { TelegramBotApi } from './bot-api';

describe('TelegramBotApi', () => {
  it('getMe parses bot info', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { id: 123, is_bot: true, first_name: 'TestBot', username: 'testbot' } }),
    });
    const api = new TelegramBotApi({ botToken: 'token' });
    const me = await api.getMe();
    expect(me.username).toBe('testbot');
  });

  it('sendMessage sends text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } } }),
    });
    const api = new TelegramBotApi({ botToken: 'token' });
    const result = await api.sendMessage(1, 'hello');
    expect(result.message_id).toBe(1);
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }),
    });
    const api = new TelegramBotApi({ botToken: 'token' });
    await expect(api.getMe()).rejects.toThrow('Telegram API error');
  });
});
