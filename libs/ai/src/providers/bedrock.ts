import { streamText, generateText, embed, embedMany } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from '../provider';
import type { ToolSet } from 'ai';
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
  readonly region: string;
  private readonly hasExplicitCredentials: boolean;

  private readonly client: ReturnType<typeof createAmazonBedrock>;

  constructor(config: TenantLLMConfig) {
    this.chatModel = config.chatModel ?? DEFAULT_BEDROCK_CHAT_MODEL;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_BEDROCK_EMBEDDING_MODEL;
    this.embeddingDimensions = config.embeddingDimensions ?? 1024;
    this.region = config.region ?? env.AWS_REGION;
    this.hasExplicitCredentials = !!(config.accessKeyId && config.secretAccessKey);

    this.client = createAmazonBedrock({
      region: this.region,
      ...(this.hasExplicitCredentials
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : { credentialProvider: defaultProvider() }),
    });
  }

  streamChat(options: BaseStreamChatOptions): StreamChatResult {
    const {
      messages,
      model,
      system,
      temperature = 0.7,
      maxOutputTokens,
      tools,
      maxSteps,
      onFinish,
    } = options;
    return streamText({
      model: this.client(model ?? this.chatModel),
      messages,
      system,
      temperature,
      ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
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
    // When explicit credentials are provided, skip defaultProvider validation
    if (this.hasExplicitCredentials) {
      return;
    }

    try {
      const credentials = await defaultProvider()();
      if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
        throw new Error('Incomplete AWS credentials');
      }
    } catch {
      throw new Error(
        'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure ~/.aws/credentials.'
      );
    }
  }
}
