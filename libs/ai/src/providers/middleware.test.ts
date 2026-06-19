import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStreamText, mockWrapLanguageModel } = vi.hoisted(() => ({
  mockStreamText: vi.fn(() => ({ textStream: 'mock-stream', text: Promise.resolve(''), usage: Promise.resolve({}) })),
  mockWrapLanguageModel: vi.fn(({ model }) => model),
}));

// Stub the bedrock client factory so streamText is never actually called.
// The real createAmazonBedrock returns a callable provider; mirror that shape.
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: () => {
    const provider = (id: string) => ({ modelId: id, specificationVersion: 'v3', provider: 'bedrock' });
    provider.textEmbeddingModel = (id: string) => ({ modelId: id, type: 'embedding' });
    return provider;
  },
}));

// Stub the AWS credential chain so the constructor never touches real AWS.
vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: () => () => Promise.resolve({ accessKeyId: 'test-key', secretAccessKey: 'test-secret' }),
}));

// Partial mock of `ai`: intercept streamText (no real model invocation) and
// spy on wrapLanguageModel so we can assert it is/isn't applied.
vi.mock('ai', () => ({
  streamText: mockStreamText,
  wrapLanguageModel: mockWrapLanguageModel,
}));

import { BedrockLLMProvider } from './bedrock';
import type { TenantLLMConfig } from '../types';

describe('BedrockLLMProvider with middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies wrapLanguageModel when middleware is provided', () => {
    const provider = new BedrockLLMProvider({ provider: 'bedrock' } as TenantLLMConfig);

    expect(() => provider.streamChat({
      messages: [{ role: 'user', content: 'hi' }] as any,
      middleware: { specificationVersion: 'v3' } as any,
    })).not.toThrow();
    expect(mockWrapLanguageModel).toHaveBeenCalledTimes(1);
    expect(mockWrapLanguageModel).toHaveBeenCalledWith({
      model: expect.anything(),
      middleware: { specificationVersion: 'v3' } as any,
    });
  });

  it('does not apply wrapLanguageModel when middleware is absent', () => {
    const provider = new BedrockLLMProvider({ provider: 'bedrock' } as TenantLLMConfig);

    expect(() => provider.streamChat({
      messages: [{ role: 'user', content: 'hi' }] as any,
    })).not.toThrow();
    expect(mockWrapLanguageModel).not.toHaveBeenCalled();
  });
});