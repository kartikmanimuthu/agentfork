import type { ModelMessage, LanguageModelUsage, ToolSet } from 'ai';
import type { ProviderName } from './types';

export interface BaseStreamChatOptions {
  messages: ModelMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolSet;
  maxSteps?: number;
  onFinish?: (result: { text: string; usage: LanguageModelUsage }) => void | Promise<void>;
}

export interface StreamChatResult {
  toUIMessageStreamResponse(options?: {
    headers?: Record<string, string>;
    onError?: (error: unknown) => string;
  }): Response;
  text: PromiseLike<string>;
  usage: PromiseLike<LanguageModelUsage>;
  textStream: AsyncIterable<string>;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  streamChat(options: BaseStreamChatOptions): StreamChatResult;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Validate that the provider is usable (e.g. credentials are resolvable). Throws on failure. */
  validate(): Promise<void>;
}
