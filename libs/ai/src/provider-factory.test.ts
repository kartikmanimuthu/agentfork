import { describe, it, expect, vi } from 'vitest';
import { createLLMProvider, getDefaultProvider } from './provider-factory';
import { BedrockLLMProvider } from './providers/bedrock';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn(() => vi.fn(() => Promise.resolve({
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  }))),
}));

describe('createLLMProvider', () => {
  it('returns a BedrockLLMProvider when called with no config', () => {
    const provider = createLLMProvider();
    expect(provider).toBeInstanceOf(BedrockLLMProvider);
  });

  it('returns a BedrockLLMProvider when called with null config', () => {
    const provider = createLLMProvider(null);
    expect(provider).toBeInstanceOf(BedrockLLMProvider);
  });

  it('returns a BedrockLLMProvider when provider is bedrock', () => {
    const provider = createLLMProvider({ provider: 'bedrock' });
    expect(provider).toBeInstanceOf(BedrockLLMProvider);
  });

  it('returns an OpenAICompatibleProvider when provider is openai', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('throws an error for an unknown provider', () => {
    expect(() => createLLMProvider({ provider: 'unknown' as any })).toThrow(
      'Unknown LLM provider: unknown'
    );
  });
});

describe('getDefaultProvider', () => {
  it('returns a BedrockLLMProvider', () => {
    const provider = getDefaultProvider();
    expect(provider).toBeInstanceOf(BedrockLLMProvider);
  });
});
