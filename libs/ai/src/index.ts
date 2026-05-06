export { createLLMProvider, getDefaultProvider } from './provider-factory';
export { streamChat, type StreamChatOptions } from './chat-completion';
export { generateEmbedding, generateEmbeddings } from './embeddings';
export type { LLMProvider, BaseStreamChatOptions } from './provider';
export type { TenantLLMConfig, ProviderName } from './types';
export {
  getDefaultLLMConfig,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from './types';

// Legacy exports — still used by libs/knowledge-base and workers during migration.
// TODO: Remove once all consumers migrate to createLLMProvider/getDefaultProvider.
export { getBedrockProvider } from './bedrock-client';
