import { embed, embedMany } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { createCohere } from '@ai-sdk/cohere';
import { getBedrockProvider } from '@chatbot/ai';
import type { EmbeddingProvider } from '../types';

// ─── Credentials helper ───────────────────────────────────────────────────────

interface EmbeddingCredentials {
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
}

// ─── Bedrock Titan ────────────────────────────────────────────────────────────

export class BedrockTitanEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'BEDROCK_TITAN';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 100;
  private readonly client: ReturnType<typeof createAmazonBedrock>;

  constructor(
    model = 'amazon.titan-embed-text-v2:0',
    dimensions = 1024,
    config?: EmbeddingCredentials
  ) {
    this.model = model;
    this.dimensions = dimensions;
    if (config?.accessKeyId && config?.secretAccessKey && config?.region) {
      this.client = createAmazonBedrock({
        region: config.region,
        credentialProvider: () =>
          Promise.resolve({
            accessKeyId: config.accessKeyId!,
            secretAccessKey: config.secretAccessKey!,
          }),
      });
    } else {
      this.client = getBedrockProvider();
    }
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.client.textEmbeddingModel(this.model),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.client.textEmbeddingModel(this.model),
      values: texts,
    });
    return embeddings;
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'OPENAI';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 2048;
  private readonly apiKey: string;
  private readonly baseUrl?: string;

  constructor(
    model = 'text-embedding-3-large',
    dimensions = 3072,
    config?: EmbeddingCredentials
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.apiKey = config?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.baseUrl = config?.baseUrl;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OpenAI API key is required');

    const openai = createOpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(this.model),
      values: texts,
    });
    return embeddings;
  }
}

// ─── Cohere ───────────────────────────────────────────────────────────────────

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'COHERE';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 96;

  constructor(model = 'embed-english-v3.0', dimensions = 1024) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const apiKey = process.env['COHERE_API_KEY'];
    if (!apiKey) throw new Error('COHERE_API_KEY environment variable is required');

    const cohere = createCohere({ apiKey });
    const { embeddings } = await embedMany({
      model: cohere.textEmbeddingModel(this.model),
      values: texts,
    });
    return embeddings;
  }
}

// ─── Ollama (local) ───────────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'LOCAL';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 32;
  private readonly baseUrl: string;

  constructor(
    model = 'nomic-embed-text',
    dimensions = 768,
    config?: EmbeddingCredentials
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = config?.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embedding failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { embedding: number[] };
      results.push(data.embedding);
    }

    return results;
  }
}

// ─── Legacy factory ───────────────────────────────────────────────────────────

export type EmbeddingProviderName = 'BEDROCK_TITAN' | 'OPENAI' | 'COHERE' | 'LOCAL';

export interface EmbeddingProviderOptions {
  model?: string;
  dimensions?: number;
}

const LEGACY_PROVIDER_NAMES: string[] = ['BEDROCK_TITAN', 'OPENAI', 'COHERE', 'LOCAL'];

function isLegacyProviderName(value: string): value is EmbeddingProviderName {
  return LEGACY_PROVIDER_NAMES.includes(value);
}

function getLegacyEmbeddingProvider(
  providerName: EmbeddingProviderName,
  options: EmbeddingProviderOptions = {}
): EmbeddingProvider {
  switch (providerName) {
    case 'BEDROCK_TITAN':
      return new BedrockTitanEmbeddingProvider(options.model, options.dimensions);
    case 'OPENAI':
      return new OpenAIEmbeddingProvider(options.model, options.dimensions);
    case 'COHERE':
      return new CohereEmbeddingProvider(options.model, options.dimensions);
    case 'LOCAL':
      return new OllamaEmbeddingProvider(options.model, options.dimensions);
    default: {
      const _exhaustive: never = providerName;
      throw new Error(`Unknown embedding provider: ${_exhaustive}`);
    }
  }
}

// ─── Config-aware factory ─────────────────────────────────────────────────────

interface EmbeddingProviderConfig {
  provider: 'bedrock' | 'openai' | 'anthropic' | 'ollama' | 'vllm' | 'openai_compatible';
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
}


export function getEmbeddingProvider(
  config: EmbeddingProviderConfig,
  options?: EmbeddingProviderOptions
): EmbeddingProvider;

export function getEmbeddingProvider(
  providerName: EmbeddingProviderName,
  options?: EmbeddingProviderOptions
): EmbeddingProvider;

export function getEmbeddingProvider(
  input: EmbeddingProviderConfig | EmbeddingProviderName,
  options: EmbeddingProviderOptions = {}
): EmbeddingProvider {
  if (typeof input === 'string') {
    if (isLegacyProviderName(input)) {
      return getLegacyEmbeddingProvider(input, options);
    }
    throw new Error(
      `Unknown embedding provider: ${input}. Expected a legacy provider name or a TenantLLMConfig object.`
    );
  }

  const model = options.model ?? input.embeddingModel;
  const dimensions = options.dimensions ?? input.embeddingDimensions;

  switch (input.provider) {
    case 'bedrock':
      return new BedrockTitanEmbeddingProvider(model, dimensions, {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        region: input.region,
      });
    case 'openai':
    case 'openai_compatible':
    case 'vllm':
      return new OpenAIEmbeddingProvider(model, dimensions, {
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
      });
    case 'ollama':
      return new OllamaEmbeddingProvider(model, dimensions, {
        baseUrl: input.baseUrl,
      });
    case 'anthropic':
      throw new Error('Anthropic does not support embeddings');
    default:
      throw new Error(`Unknown embedding provider: ${(input as any).provider}`);
  }
}
