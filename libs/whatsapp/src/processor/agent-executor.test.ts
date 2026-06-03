import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppAgentExecutor } from './agent-executor';

const mockPrisma = {
  agent: { findFirst: vi.fn() },
};

const mockLlmProvider = {
  chat: vi.fn(),
};

const mockProviderFactory = vi.fn();

describe('WhatsAppAgentExecutor', () => {
  let executor: WhatsAppAgentExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WhatsAppAgentExecutor(mockPrisma as any, mockProviderFactory as any);
  });

  it('executes a simple agent with system prompt', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-sonnet-4-6', systemPrompt: 'You are a helpful assistant.', temperature: 0.7 },
    });
    mockProviderFactory.mockReturnValueOnce(mockLlmProvider);
    mockLlmProvider.chat.mockResolvedValueOnce({ text: 'Hello! How can I help?' });

    const result = await executor.execute('agent_1', { text: 'Hi there' }, {});

    expect(result.text).toBe('Hello! How can I help?');
    expect(mockLlmProvider.chat).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' }),
        expect.objectContaining({ role: 'user', content: 'Hi there' }),
      ]),
    }));
  });

  it('includes conversation context in messages', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-sonnet-4-6', systemPrompt: 'Assistant', temperature: 0.7 },
    });
    mockProviderFactory.mockReturnValueOnce(mockLlmProvider);
    mockLlmProvider.chat.mockResolvedValueOnce({ text: 'Your order is on the way.' });

    const context = {
      messages: [
        { role: 'user', content: 'Where is my order?' },
        { role: 'assistant', content: 'Let me check. What is your order number?' },
      ],
    };

    const result = await executor.execute('agent_1', { text: 'Order #123' }, context);

    expect(result.text).toBe('Your order is on the way.');
    expect(mockLlmProvider.chat).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Where is my order?' }),
        expect.objectContaining({ role: 'assistant', content: 'Let me check. What is your order number?' }),
        expect.objectContaining({ role: 'user', content: 'Order #123' }),
      ]),
    }));
  });

  it('throws when agent not found', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce(null);
    await expect(executor.execute('nonexistent', { text: 'Hi' }, {})).rejects.toThrow('Agent not found: nonexistent');
  });

  it('executes a graph agent using GraphExecutor and returns text from output channel', async () => {
    const mockExecuteFromState = vi.fn().mockResolvedValue({
      channels: { response: 'Hello from graph!' },
      messages: [],
      currentNodeId: null,
      metadata: { executionId: 'e1', agentId: 'graph_1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    });

    const mockRegister = vi.fn();

    vi.doMock('@chatbot/agent-studio/server', () => ({
      GraphExecutor: vi.fn().mockImplementation(() => ({
        register: mockRegister,
        executeFromState: mockExecuteFromState,
      })),
      createNodeExecutors: vi.fn().mockReturnValue([]),
    }));

    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'graph_1',
      type: 'graph',
      config: {
        nodes: [{ id: 'n1', type: 'whatsapp_trigger', config: { type: 'whatsapp_trigger' } }],
        edges: [],
      },
    });

    const result = await executor.execute(
      'graph_1',
      { text: 'Hi from WhatsApp' },
      {
        wa_sender_id: '919876543210',
        wa_phone_number_id: 'phone_123',
        wa_account_id: 'acc_1',
        wa_session_id: 'sess_1',
        wa_within_window: true,
        wa_message_type: 'text',
        wa_media_id: null,
        tenantId: 'tenant_1',
      },
    );

    expect(result.text).toBe('Hello from graph!');
    expect(mockExecuteFromState).toHaveBeenCalledOnce();
  });
});
