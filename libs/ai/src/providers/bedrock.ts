import { streamText, embed, embedMany } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from '../provider';
import type { TenantLLMConfig, ProviderName } from '../types';
import {
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
} from '../types';
import { env } from '../env';

export class BedrockLLMProvider implements LLMProvider {
  readonly name: ProviderName = 'bedrock';
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  private readonly client = createAmazonBedrock({
    region: env.AWS_REGION,
    credentialProvider: defaultProvider(),
  });

  constructor(config: TenantLLMConfig) {
    this.chatModel = config.chatModel ?? DEFAULT_BEDROCK_CHAT_MODEL;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_BEDROCK_EMBEDDING_MODEL;
    this.embeddingDimensions = config.embeddingDimensions ?? 1024;
  }

  streamChat(options: BaseStreamChatOptions): StreamChatResult {
    const {
      messages,
      model,
      system,
      temperature = 0.7,
      maxOutputTokens = 4096,
      onFinish,
    } = options;
    return streamText({
      model: this.client(model ?? this.chatModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      onFinish,
    });
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      values: texts,
    });
    return embeddings;
  }
}
