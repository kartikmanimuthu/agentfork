import { embed, embedMany } from 'ai';
import { getBedrockProvider } from '@chatbot/ai';
import type { EmbeddingProvider } from '../types';

// ─── Bedrock Titan ────────────────────────────────────────────────────────────

export class BedrockTitanEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'BEDROCK_TITAN';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 100;

  constructor(
    model = 'amazon.titan-embed-text-v2:0',
    dimensions = 1024
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const bedrock = getBedrockProvider();
    const { embedding } = await embed({
      model: bedrock.textEmbeddingModel(this.model),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const bedrock = getBedrockProvider();
    const { embeddings } = await embedMany({
      model: bedrock.textEmbeddingModel(this.model),
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

  constructor(model = 'text-embedding-3-large', dimensions = 3072) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // @ts-ignore — @ai-sdk/openai is an optional peer dependency
    const { createOpenAI } = await import('@ai-sdk/openai').catch(() => {
      throw new Error(
        'OpenAI embedding requires "@ai-sdk/openai". Install with: bun add @ai-sdk/openai'
      );
    });
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required');

    const openai = createOpenAI({ apiKey });
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(this.model, { dimensions: this.dimensions }),
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
    // @ts-ignore — @ai-sdk/cohere is an optional peer dependency
    const { createCohere } = await import('@ai-sdk/cohere').catch(() => {
      throw new Error(
        'Cohere embedding requires "@ai-sdk/cohere". Install with: bun add @ai-sdk/cohere'
      );
    });
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

  constructor(model = 'nomic-embed-text', dimensions = 768) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
    const results: number[][] = [];

    for (const text of texts) {
      const res = await fetch(`${baseUrl}/api/embeddings`, {
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

// ─── Factory ──────────────────────────────────────────────────────────────────

export type EmbeddingProviderName = 'BEDROCK_TITAN' | 'OPENAI' | 'COHERE' | 'LOCAL';

export interface EmbeddingProviderOptions {
  model?: string;
  dimensions?: number;
}

export function getEmbeddingProvider(
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
