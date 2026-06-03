import { describe, it, expect, vi } from 'vitest';

vi.mock('@chatbot/shared', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { WhatsAppTriggerNodeExecutor } from './whatsapp-trigger-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown>, config = {}): NodeExecutionContext {
  return {
    state: {
      channels,
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_trigger', label: 'WA Trigger', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_trigger', ...config },
    services: { llmProvider: async () => ({}), prisma: {} },
    emit: () => {},
  };
}

describe('WhatsAppTriggerNodeExecutor', () => {
  const executor = new WhatsAppTriggerNodeExecutor();

  it('has type whatsapp_trigger', () => {
    expect(executor.type).toBe('whatsapp_trigger');
  });

  it('passes through wa_* channels into stateUpdates', async () => {
    const ctx = makeCtx({
      wa_sender_id: '919876543210',
      wa_message_text: 'Hello',
      wa_message_type: 'text',
      wa_media_id: null,
      wa_phone_number_id: 'phone_123',
      wa_account_id: 'acc_1',
      wa_session_id: 'sess_1',
      wa_within_window: true,
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toMatchObject({
      wa_sender_id: '919876543210',
      wa_message_text: 'Hello',
      wa_message_type: 'text',
      wa_within_window: true,
    });
    expect(result.trace.status).toBe('completed');
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx({ wa_phone_number_id: 'phone_123' });
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });

  it('throws when wa_phone_number_id is missing', async () => {
    const ctx = makeCtx({ wa_sender_id: '919876543210' });
    await expect(executor.execute(ctx)).rejects.toThrow('wa_phone_number_id');
  });

  it('remaps channels when channelMap is configured', async () => {
    const ctx = makeCtx(
      { wa_sender_id: '919876543210', wa_message_text: 'Hi', wa_phone_number_id: 'phone_123' },
      { channelMap: { messageTextChannel: 'user_input' } },
    );

    const result = await executor.execute(ctx);

    expect(result.stateUpdates['user_input']).toBe('Hi');
    expect(result.stateUpdates['wa_message_text']).toBe('Hi');
  });
});
