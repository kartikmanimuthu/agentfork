import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { LLMProvider, BaseStreamChatOptions } from './provider';

export interface StreamChatOptions extends BaseStreamChatOptions {
  provider: LLMProvider;
}

export function streamChat(options: StreamChatOptions) {
  return options.provider.streamChat(options);
}
