import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaWhatsAppClient } from './meta-api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MetaWhatsAppClient', () => {
  let client: MetaWhatsAppClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MetaWhatsAppClient({
      accessToken: 'test-token',
      phoneNumberId: 'PHONE_ID',
      apiVersion: 'v21.0',
    });
  });

  describe('sendTextMessage', () => {
    it('sends a text message and returns message id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '15559876543', wa_id: '15559876543' }],
          messages: [{ id: 'wamid.sent123' }],
        }),
      });

      const result = await client.sendTextMessage('15559876543', 'Hello!');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PHONE_ID/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result.messages[0].id).toBe('wamid.sent123');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid recipient', type: 'OAuthException', code: 100, fbtrace_id: 'trace' },
        }),
      });

      await expect(client.sendTextMessage('invalid', 'Hi')).rejects.toThrow('Invalid recipient');
    });
  });

  describe('getMediaUrl', () => {
    it('fetches media download URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.fbsbx.com/media/123',
          mime_type: 'image/jpeg',
          sha256: 'abc',
          file_size: 1024,
          id: 'media_123',
        }),
      });

      const result = await client.getMediaUrl('media_123');
      expect(result.url).toBe('https://lookaside.fbsbx.com/media/123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/media_123',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
      );
    });
  });

  describe('sendInteractiveMessage', () => {
    it('sends a button message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '15559876543', wa_id: '15559876543' }],
          messages: [{ id: 'wamid.interactive1' }],
        }),
      });

      const result = await client.sendInteractiveMessage('15559876543', {
        type: 'button',
        body: { text: 'Choose an option:' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'sales', title: 'Sales' } },
            { type: 'reply', reply: { id: 'support', title: 'Support' } },
          ],
        },
      });

      expect(result.messages[0].id).toBe('wamid.interactive1');
    });
  });
});
