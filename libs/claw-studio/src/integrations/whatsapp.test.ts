import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { data: Record<string, unknown> }>();
const mockGet = vi.fn(async (key: string) => store.get(key)?.data ?? null);
const mockSet = vi.fn(async (key: string, value: Record<string, unknown>) => {
  store.set(key, { data: value });
});
const mockDelete = vi.fn(async (key: string) => store.delete(key));
const mockListByPrefix = vi.fn(async (prefix: string) =>
  Array.from(store.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([configKey, row]) => ({ configKey, data: row.data, updatedAt: new Date(), updatedBy: 'system' })),
);

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    listByPrefix: mockListByPrefix,
  })),
  EncryptionService: vi.fn().mockImplementation(() => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
  })),
}));

import { whatsappDescriptor, createWhatsappTools } from './whatsapp';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

describe('whatsappDescriptor.verify', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('rejects missing fields without calling the API', async () => {
    const result = await whatsappDescriptor.verify({});
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token with no phone number id', async () => {
    const result = await whatsappDescriptor.verify({ accessToken: 'meta-test' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds and surfaces the display phone number on valid credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ display_phone_number: '+1 555 123 4567' }));
    const result = await whatsappDescriptor.verify({ accessToken: 'meta-test', phoneNumberId: '123456' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toContain('+1 555 123 4567');
      expect(result.meta?.displayPhoneNumber).toBe('+1 555 123 4567');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer meta-test' }) }),
    );
  });

  it('surfaces the Graph API error body on a rejected token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Invalid OAuth access token' } }, false, 401));
    const result = await whatsappDescriptor.verify({ accessToken: 'bad-token', phoneNumberId: '123456' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });
});

describe('createWhatsappTools', () => {
  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
  });

  it('returns exactly the two outbound-only send tools', () => {
    const tools = createWhatsappTools('tenant-1');
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['whatsapp_send_message', 'whatsapp_send_template']);
  });

  it('reports not-connected without calling the API when no account exists', async () => {
    const [sendMessage] = createWhatsappTools('tenant-1');
    const result = await sendMessage.invoke({ to: '15551234567', text: 'hi' } as never);
    expect(result).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('whatsapp_send_message posts a text message once connected', async () => {
    store.set('claw-integration-whatsapp:account:default', {
      data: { accessToken: 'enc(meta-real)', phoneNumberId: '123456' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.1' }] }));

    const [sendMessage] = createWhatsappTools('tenant-1');
    const result = await sendMessage.invoke({ to: '15551234567', text: 'Hello there' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer meta-real' }),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '15551234567',
          type: 'text',
          text: { body: 'Hello there' },
        }),
      }),
    );
    expect(result).toContain('wamid.1');
  });

  it('whatsapp_send_template posts a template message once connected', async () => {
    store.set('claw-integration-whatsapp:account:default', {
      data: { accessToken: 'enc(meta-real)', phoneNumberId: '123456' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.2' }] }));

    const tools = createWhatsappTools('tenant-1');
    const sendTemplate = tools.find((t) => t.name === 'whatsapp_send_template')!;
    const result = await sendTemplate.invoke({ to: '15551234567', templateName: 'order_update' } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '15551234567',
          type: 'template',
          template: { name: 'order_update', language: { code: 'en_US' } },
        }),
      }),
    );
    expect(result).toContain('wamid.2');
  });

  it('a failed send returns a descriptive error string rather than throwing', async () => {
    store.set('claw-integration-whatsapp:account:default', {
      data: { accessToken: 'enc(meta-real)', phoneNumberId: '123456' },
    });
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Recipient outside 24h window' } }, false, 400));

    const [sendMessage] = createWhatsappTools('tenant-1');
    const result = await sendMessage.invoke({ to: '15551234567', text: 'hi' } as never);
    expect(result).toContain('Error sending WhatsApp message');
    expect(result).toContain('400');
  });
});
