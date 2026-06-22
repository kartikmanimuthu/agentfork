import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendTemplateMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.tpl' }] });

vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTemplateMessage: mockSendTemplateMessage,
  })),
}));

vi.mock('@chatbot/shared', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  EncryptionService: vi.fn().mockImplementation(() => ({
    decrypt: vi.fn().mockReturnValue('decrypted-token'),
  })),
}));

import { WhatsAppSendTemplateNodeExecutor } from './whatsapp-send-template-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown> = {}, config: Record<string, unknown> = {}): NodeExecutionContext {
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
      }),
    },
  };
  return {
    state: {
      channels: {
        wa_sender_id: '919876543210',
        wa_account_id: 'acc_1',
        ...channels,
      },
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_send_template', label: 'WA Template', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_send_template', templateName: 'hello_world', languageCode: 'en', ...config },
    services: { llmProvider: async () => ({}), prisma: mockPrisma },
    emit: () => {},
  };
}

describe('WhatsAppSendTemplateNodeExecutor', () => {
  const executor = new WhatsAppSendTemplateNodeExecutor();

  beforeEach(() => { vi.clearAllMocks(); });

  it('has type whatsapp_send_template', () => {
    expect(executor.type).toBe('whatsapp_send_template');
  });

  it('sends template without components and returns wa_last_sent_message_id', async () => {
    const ctx = makeCtx();
    const result = await executor.execute(ctx);
    expect(result.stateUpdates['wa_last_sent_message_id']).toBe('wamid.tpl');
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', undefined);
  });

  it('parses components from channel when componentsChannel is set (JSON string)', async () => {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Omar' }] }];
    const ctx = makeCtx(
      { tpl_components: JSON.stringify(components) },
      { componentsChannel: 'tpl_components' },
    );
    await executor.execute(ctx);
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', components);
  });

  it('accepts components channel value already parsed as array', async () => {
    const components = [{ type: 'body', parameters: [] }];
    const ctx = makeCtx({ tpl_components: components }, { componentsChannel: 'tpl_components' });
    await executor.execute(ctx);
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', components);
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx();
    delete (ctx.state.channels as any)['wa_sender_id'];
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });
});
