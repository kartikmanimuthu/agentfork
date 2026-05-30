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

export { createDiscovery } from './discovery';
export type { DiscoveredModel, ModelCapability } from './discovery';

export {
  textContentPartSchema,
  fileContentPartSchema,
  contentPartSchema,
  contentPartsMessageSchema,
  type TextContentPart,
  type FileContentPart,
  type ContentPart,
  type ContentPartsMessage,
  type MessageAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_EXTRACTED_TEXT_LENGTH,
} from './multimodal-types';

export {
  ContentResolver,
  type FileDownloader,
  type StoredMessage,
  type ResolvedMessage,
  type ResolvedContent,
} from './content-resolver';

// Legacy exports — still used by libs/knowledge-base and workers during migration.
// TODO: Remove once all consumers migrate to createLLMProvider/getDefaultProvider.
export { getBedrockProvider } from './bedrock-client';
