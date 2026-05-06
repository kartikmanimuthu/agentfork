import { streamText, embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { LLMProvider } from '../provider';
import type { BaseStreamChatOptions } from '../provider';
import type { TenantLLMConfig, ProviderName } from '../types';
import {
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from '../types';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: ProviderName = 'openai';
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(config: TenantLLMConfig) {
    if (!config.baseUrl) {
      throw new Error('OpenAI-compatible provider requires baseUrl');
    }
    this.chatModel = config.chatModel ?? DEFAULT_OPENAI_CHAT_MODEL;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
    this.embeddingDimensions = config.embeddingDimensions ?? 3072;

    this.client = createOpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
  }

  streamChat(options: BaseStreamChatOptions) {
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
