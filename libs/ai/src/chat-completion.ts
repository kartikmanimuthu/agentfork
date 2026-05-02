import { streamText, type ModelMessage, type LanguageModelUsage } from 'ai';
import { getBedrockProvider, DEFAULT_MODEL } from './bedrock-client';

export interface StreamChatOptions {
  messages: ModelMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onFinish?: (result: { text: string; usage: LanguageModelUsage }) => void | Promise<void>;
}

export function streamChat(options: StreamChatOptions) {
  const { messages, model, system, temperature = 0.7, maxOutputTokens = 4096, onFinish } = options;
  const bedrock = getBedrockProvider();

  return streamText({
    model: bedrock(model ?? DEFAULT_MODEL),
    messages,
    system,
    temperature,
    maxOutputTokens,
    onFinish,
  });
}
