import { describe, it, expect } from 'vitest';
import {
  getDefaultLLMConfig,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from './types';

describe('getDefaultLLMConfig', () => {
  it('returns Bedrock defaults when provider is bedrock', () => {
    const config = getDefaultLLMConfig('bedrock');
    expect(config).toEqual({
      provider: 'bedrock',
      chatModel: DEFAULT_BEDROCK_CHAT_MODEL,
      embeddingModel: DEFAULT_BEDROCK_EMBEDDING_MODEL,
      embeddingDimensions: 1024,
    });
  });

  it('returns OpenAI defaults when provider is openai', () => {
    const config = getDefaultLLMConfig('openai');
    expect(config).toEqual({
      provider: 'openai',
      chatModel: DEFAULT_OPENAI_CHAT_MODEL,
      embeddingModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: 3072,
    });
  });

  it('returns Bedrock defaults when called with no arguments', () => {
    const config = getDefaultLLMConfig();
    expect(config).toEqual({
      provider: 'bedrock',
      chatModel: DEFAULT_BEDROCK_CHAT_MODEL,
      embeddingModel: DEFAULT_BEDROCK_EMBEDDING_MODEL,
      embeddingDimensions: 1024,
    });
  });
});
