export type ProviderName = 'bedrock' | 'openai';

export interface TenantLLMConfig {
  provider: ProviderName;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  baseUrl?: string;
  apiKey?: string;
}

export const DEFAULT_BEDROCK_CHAT_MODEL = 'anthropic.claude-sonnet-4-20250514';
export const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

export function getDefaultLLMConfig(provider: ProviderName = 'bedrock'): TenantLLMConfig {
  if (provider === 'openai') {
    return {
      provider: 'openai',
      chatModel: DEFAULT_OPENAI_CHAT_MODEL,
      embeddingModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: 3072,
    };
  }
  return {
    provider: 'bedrock',
    chatModel: DEFAULT_BEDROCK_CHAT_MODEL,
    embeddingModel: DEFAULT_BEDROCK_EMBEDDING_MODEL,
    embeddingDimensions: 1024,
  };
}
