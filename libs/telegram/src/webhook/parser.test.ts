import { describe, it, expect } from 'vitest';
import { parseWebhookBody } from './parser';

describe('parseWebhookBody', () => {
  it('parses text message', () => {
    const event = parseWebhookBody({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false, first_name: 'User' },
        chat: { id: 1, type: 'private' },
        date: 1,
        text: 'hello',
      },
    });
    expect(event?.type).toBe('message');
    expect(event?.text).toBe('hello');
    expect(event?.isGroup).toBe(false);
  });

  it('parses callback_query', () => {
    const event = parseWebhookBody({
      update_id: 1,
      callback_query: {
        id: 'cq1',
        from: { id: 1, is_bot: false, first_name: 'User' },
        message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 1 },
        data: 'btn_1',
      },
    });
    expect(event?.type).toBe('callback_query');
    expect(event?.callbackData).toBe('btn_1');
  });

  it('returns null for unsupported update', () => {
    const event = parseWebhookBody({ update_id: 1 });
    expect(event).toBeNull();
  });
});
