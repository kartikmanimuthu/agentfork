import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from './provider';

export interface StreamChatOptions extends BaseStreamChatOptions {
  provider: LLMProvider;
}

export function streamChat(options: StreamChatOptions): StreamChatResult {
  const { provider, ...rest } = options;
  return provider.streamChat(rest);
}
