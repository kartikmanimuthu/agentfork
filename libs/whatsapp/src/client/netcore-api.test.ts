import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetcoreWhatsAppClient } from './netcore-api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NetcoreWhatsAppClient', () => {
  let client: NetcoreWhatsAppClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new NetcoreWhatsAppClient({
      accessToken: 'test-api-key',
      phoneNumberId: '919711750243',
    });
  });

  describe('sendTextMessage', () => {
    it('sends a text message with Bearer auth and returns a normalized message id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          message: 'Request received successfully.',
          data: { id: '6132367d-c37e-4e32-a9a2-d0e9d64d6708' },
        }),
      });

      const result = await client.sendTextMessage('918826603017', 'Hello!');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cpaaswa.netcorecloud.net/api/v2/message/nc/priority',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.message[0]).toEqual(expect.objectContaining({
        recipient_whatsapp: '918826603017',
        recipient_type: 'individual',
        message_type: 'text',
        type_text: [{ content: 'Hello!' }],
      }));

      expect(result).toEqual({
        messaging_product: 'whatsapp',
        contacts: [],
        messages: [{ id: '6132367d-c37e-4e32-a9a2-d0e9d64d6708' }],
      });
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden', message: 'Access Denied', status: 403 }),
      });

      await expect(client.sendTextMessage('918826603017', 'Hi')).rejects.toThrow('Access Denied');
    });
  });

  describe('sendInteractiveMessage', () => {
    it('throws a clear not-yet-supported error', async () => {
      await expect(
        client.sendInteractiveMessage('918826603017', { type: 'button', body: { text: 'Choose' }, action: {} } as any),
      ).rejects.toThrow('not yet supported for Netcore');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
