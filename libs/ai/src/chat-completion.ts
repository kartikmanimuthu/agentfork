import type { LLMProvider, BaseStreamChatOptions } from './provider';

export interface StreamChatOptions extends BaseStreamChatOptions {
  provider: LLMProvider;
}

export function streamChat(options: StreamChatOptions) {
  const { provider, ...rest } = options;
  return provider.streamChat(rest);
}
