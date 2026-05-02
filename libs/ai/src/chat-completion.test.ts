import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStreamText } = vi.hoisted(() => ({
  mockStreamText: vi.fn(() => ({ textStream: 'mock-stream' })),
}));

vi.mock('ai', () => ({
  streamText: mockStreamText,
}));

vi.mock('./bedrock-client', () => {
  const provider = (model: string) => ({ modelId: model });
  provider.textEmbeddingModel = (model: string) => ({ modelId: model });
  return {
    getBedrockProvider: vi.fn(() => provider),
    DEFAULT_MODEL: 'anthropic.claude-sonnet-4-20250514',
  };
});

import { streamChat, type StreamChatOptions } from './chat-completion';

describe('streamChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls streamText with default options', () => {
    const options: StreamChatOptions = {
      messages: [{ role: 'user', content: 'hello' }] as any,
    };
    streamChat(options);
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: options.messages,
        temperature: 0.7,
        maxOutputTokens: 4096,
      }),
    );
  });

  it('uses DEFAULT_MODEL when no model specified', () => {
    streamChat({ messages: [] as any });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.model).toEqual({ modelId: 'anthropic.claude-sonnet-4-20250514' });
  });

  it('uses custom model when specified', () => {
    streamChat({ messages: [] as any, model: 'anthropic.claude-haiku-4-5-20251001' });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.model).toEqual({ modelId: 'anthropic.claude-haiku-4-5-20251001' });
  });

  it('passes system prompt', () => {
    streamChat({ messages: [] as any, system: 'You are helpful.' });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.system).toBe('You are helpful.');
  });

  it('passes custom temperature and maxOutputTokens', () => {
    streamChat({ messages: [] as any, temperature: 0.2, maxOutputTokens: 1024 });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.temperature).toBe(0.2);
    expect(call.maxOutputTokens).toBe(1024);
  });

  it('passes onFinish callback', () => {
    const onFinish = vi.fn();
    streamChat({ messages: [] as any, onFinish });
    const call = mockStreamText.mock.calls[0][0];
    expect(call.onFinish).toBe(onFinish);
  });
});
