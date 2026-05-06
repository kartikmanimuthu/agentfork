import { describe, it, expect, vi } from 'vitest';

import { streamChat, type StreamChatOptions } from './chat-completion';
import type { LLMProvider, BaseStreamChatOptions } from './provider';

function createFakeProvider(): LLMProvider {
  return {
    name: 'bedrock',
    chatModel: 'anthropic.claude-sonnet-4-20250514',
    embeddingModel: 'amazon.titan-embed-text-v2:0',
    embeddingDimensions: 1024,
    streamChat: vi.fn((options: BaseStreamChatOptions) => {
      return {
        toUIMessageStreamResponse: () => ({ body: 'mock-body' }),
      } as any;
    }),
    embed: vi.fn(),
    embedBatch: vi.fn(),
  };
}

describe('streamChat', () => {
  it('delegates to provider.streamChat with all options', () => {
    const provider = createFakeProvider();
    const onFinish = vi.fn();
    const options: StreamChatOptions = {
      provider,
      messages: [{ role: 'user', content: 'hello' }] as any,
      model: 'custom-model',
      system: 'You are helpful.',
      temperature: 0.2,
      maxOutputTokens: 1024,
      onFinish,
    };

    streamChat(options);

    expect(provider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: options.messages,
        model: 'custom-model',
        system: 'You are helpful.',
        temperature: 0.2,
        maxOutputTokens: 1024,
        onFinish,
      }),
    );
  });

  it('returns the result from provider.streamChat', () => {
    const provider = createFakeProvider();
    const result = streamChat({ provider, messages: [] as any });
    expect(result).toEqual(
      expect.objectContaining({
        toUIMessageStreamResponse: expect.any(Function),
      }),
    );
  });

  it('does not pass provider to provider.streamChat', () => {
    const provider = createFakeProvider();
    streamChat({ provider, messages: [] as any });
    const received = vi.mocked(provider.streamChat).mock.calls[0][0];
    expect(received).not.toHaveProperty('provider');
  });
});
