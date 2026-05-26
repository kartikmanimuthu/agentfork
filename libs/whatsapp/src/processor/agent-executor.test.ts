import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
