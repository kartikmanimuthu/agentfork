import { streamText, generateText, embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from '../provider';
import type { ToolSet } from 'ai';
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

  streamChat(options: BaseStreamChatOptions): StreamChatResult {
    const {
      messages,
      model,
      system,
      temperature = 0.7,
      maxOutputTokens = 4096,
      tools,
      maxSteps,
      onFinish,
    } = options;
    return streamText({
      model: this.client(model ?? this.chatModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      ...(tools && Object.keys(tools).length > 0 ? { tools, maxSteps: maxSteps ?? 5 } : {}),
      onFinish,
    });
  }

  async generateText(options: Omit<BaseStreamChatOptions, 'maxSteps' | 'onFinish'> & {
    tools?: ToolSet;
    toolChoice?: { type: 'tool'; toolName: string };
  }): Promise<{ toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> }> {
    const r = await generateText({
      model: this.client(options.model ?? this.chatModel),
      messages: options.messages,
      system: options.system,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    });
    return { toolCalls: r.toolCalls.map((c) => ({ toolName: c.toolName, args: (c as { input: Record<string, unknown> }).input })) };
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

  async validate(): Promise<void> {
    // Constructor already validates baseUrl; nothing additional needed.
  }
}
