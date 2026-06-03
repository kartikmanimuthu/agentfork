import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendTextMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.abc' }] });
const mockSendImageMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.img' }] });
const mockSendDocumentMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.doc' }] });

vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
    sendImageMessage: mockSendImageMessage,
    sendDocumentMessage: mockSendDocumentMessage,
  })),
}));

vi.mock('@chatbot/shared', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  EncryptionService: vi.fn().mockImplementation(() => ({
    decrypt: vi.fn().mockReturnValue('decrypted-access-token'),
  })),
}));

import { WhatsAppSendNodeExecutor } from './whatsapp-send-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown>, config: Record<string, unknown> = {}): NodeExecutionContext {
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
        wa_phone_number_id: 'phone_123',
        wa_account_id: 'acc_1',
        ...channels,
      },
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_send', label: 'WA Send', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_send', messageType: 'text', messageChannel: 'llm_output', ...config },
    services: { llmProvider: async () => ({}), prisma: mockPrisma },
    emit: () => {},
  };
}

describe('WhatsAppSendNodeExecutor', () => {
  const executor = new WhatsAppSendNodeExecutor();

  beforeEach(() => { vi.clearAllMocks(); });

  it('has type whatsapp_send', () => {
    expect(executor.type).toBe('whatsapp_send');
  });

  it('sends text message and returns wa_last_sent_message_id', async () => {
    const ctx = makeCtx({ llm_output: 'Hello there!' });
    const result = await executor.execute(ctx);
    expect(result.stateUpdates['wa_last_sent_message_id']).toBe('wamid.abc');
    expect(result.trace.status).toBe('completed');
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx({ llm_output: 'Hi' });
    delete (ctx.state.channels as any)['wa_sender_id'];
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });

  it('throws when wa_account_id is missing', async () => {
    const ctx = makeCtx({ llm_output: 'Hi' });
    delete (ctx.state.channels as any)['wa_account_id'];
    await expect(executor.execute(ctx)).rejects.toThrow('wa_account_id');
  });

  it('throws when message channel is empty', async () => {
    const ctx = makeCtx({ llm_output: '' });
    await expect(executor.execute(ctx)).rejects.toThrow('empty');
  });
});
