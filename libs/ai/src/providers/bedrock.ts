import { streamText, embed, embedMany, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from '../provider';
import type { TenantLLMConfig, ProviderName } from '../types';
import {
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
} from '../types';
import { env } from '../env';

// Models where Bedrock Converse API does not support tool calling.
// AWS themselves recommend using the bedrock-mantle (OpenAI-compatible) endpoint for these.
// Sources:
//   - DeepSeek V3.2 model card: no `tools` field in Converse request schema
//   - Kimi K2.5 model card: "Whenever possible, use bedrock-mantle"
const MANTLE_TOOL_PREFIXES = ['deepseek.', 'moonshotai.'];

function needsMantleForTools(modelId: string): boolean {
  return MANTLE_TOOL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

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
      maxOutputTokens = 4096,
      tools,
      maxSteps,
      onFinish,
    } = options;

    const effectiveModel = model ?? this.chatModel;
    const hasTools = !!tools && Object.keys(tools).length > 0;

    // Route to bedrock-mantle for models that don't support Converse API tool calling
    if (hasTools && needsMantleForTools(effectiveModel)) {
      const mantleClient = createOpenAI({
        baseURL: `https://bedrock-mantle.${this.region}.api.aws/v1`,
        apiKey: env.AWS_BEARER_TOKEN_BEDROCK,
      });
      return streamText({
        model: mantleClient.chat(effectiveModel), // .chat() uses /v1/chat/completions; default routes to /v1/responses in sdk v3
        messages,
        system,
        temperature,
        maxOutputTokens,
        tools,
        stopWhen: stepCountIs(maxSteps ?? 5),
        onFinish,
      });
    }

    // Default: Converse API (works for Claude, Nova, Llama, Cohere, Mistral, etc.)
    return streamText({
      model: this.client(effectiveModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      ...(hasTools ? { tools, stopWhen: stepCountIs(maxSteps ?? 5) } : {}),
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

  async validate(): Promise<void> {
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
