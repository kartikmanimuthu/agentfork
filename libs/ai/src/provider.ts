import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { ProviderName } from './types';

export interface BaseStreamChatOptions {
  messages: ModelMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onFinish?: (result: { text: string; usage: LanguageModelUsage }) => void | Promise<void>;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  streamChat(options: BaseStreamChatOptions): ReturnType<typeof import('ai').streamText>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
