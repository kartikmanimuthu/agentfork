import { streamText, type CoreMessage } from 'ai';
import { getBedrockProvider, DEFAULT_MODEL } from './bedrock-client';

export interface StreamChatOptions {
  messages: CoreMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  onFinish?: (result: { text: string; usage: { promptTokens: number; completionTokens: number } }) => void | Promise<void>;
}

export function streamChat(options: StreamChatOptions) {
  const { messages, model, system, temperature = 0.7, maxTokens = 4096, onFinish } = options;
  const bedrock = getBedrockProvider();

  return streamText({
    model: bedrock(model ?? DEFAULT_MODEL),
    messages,
    system,
    temperature,
    maxTokens,
    onFinish,
  });
}
