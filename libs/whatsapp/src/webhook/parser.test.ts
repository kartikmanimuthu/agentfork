import { describe, it, expect } from 'vitest';
import { parseWebhookPayload } from './parser';
import type { WebhookPayload } from './types';

describe('parseWebhookPayload', () => {
  it('parses a text message event', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            contacts: [{ profile: { name: 'John' }, wa_id: '15559876543' }],
            messages: [{
              from: '15559876543',
              id: 'wamid.abc123',
              timestamp: '1234567890',
              type: 'text',
              text: { body: 'Hello' },
            }],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message',
      phoneNumberId: 'PHONE_ID',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: expect.objectContaining({ id: 'wamid.abc123', type: 'text' }),
    });
  });

  it('parses a status update event', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            statuses: [{
              id: 'wamid.abc123',
              status: 'delivered',
              timestamp: '1234567890',
              recipient_id: '15559876543',
            }],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'status',
      phoneNumberId: 'PHONE_ID',
      status: expect.objectContaining({ id: 'wamid.abc123', status: 'delivered' }),
    });
  });

  it('returns empty array for non-whatsapp object', () => {
    const payload = { object: 'instagram', entry: [] } as any;
    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it('handles multiple messages in one payload', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
            contacts: [{ profile: { name: 'John' }, wa_id: '15559876543' }],
            messages: [
              { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
              { from: '15559876543', id: 'wamid.2', timestamp: '2', type: 'text', text: { body: 'Hello' } },
            ],
          },
          field: 'messages',
        }],
      }],
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('message');
    expect(events[1].type).toBe('message');
  });
});
