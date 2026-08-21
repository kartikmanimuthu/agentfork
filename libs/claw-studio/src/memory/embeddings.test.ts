import { describe, it, expect } from 'vitest';
import { BedrockEmbeddings } from '@langchain/aws';
import { OpenAIEmbeddings } from '@langchain/openai';
import { createClawEmbeddings, ClawEmbeddingsConfigError } from './embeddings';

describe('createClawEmbeddings', () => {
  it('builds a Bedrock embeddings instance for provider "bedrock"', () => {
    const embeddings = createClawEmbeddings({
      provider: 'bedrock',
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      region: 'ap-south-1',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
    });
    expect(embeddings).toBeInstanceOf(BedrockEmbeddings);
  });

  it('builds an OpenAI-compatible embeddings instance for provider "openai_compatible"', () => {
    const embeddings = createClawEmbeddings({
      provider: 'openai_compatible',
      embeddingModel: 'text-embedding-3-small',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'sk-x',
    });
    expect(embeddings).toBeInstanceOf(OpenAIEmbeddings);
  });

  it('throws when provider is "anthropic" (no embeddings API)', () => {
    expect(() =>
      createClawEmbeddings({ provider: 'anthropic', embeddingModel: 'claude-3-5' }),
    ).toThrow(ClawEmbeddingsConfigError);
  });

  it('throws when embeddingDimensions is set and does not match the required 1024', () => {
    expect(() =>
      createClawEmbeddings({
        provider: 'bedrock',
        embeddingModel: 'amazon.titan-embed-text-v2:0',
        region: 'ap-south-1',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        embeddingDimensions: 512,
      }),
    ).toThrow(/1024/);
  });

  it('throws for a known-mismatched model even when embeddingDimensions is unset — the exact gap that let a Titan G1 provider row through and silently failed every memory write', () => {
    expect(() =>
      createClawEmbeddings({
        provider: 'bedrock',
        embeddingModel: 'amazon.titan-embed-g1-text-02',
        region: 'ap-south-1',
        // embeddingDimensions intentionally omitted — reproduces the null-column case.
      }),
    ).toThrow(/1536-dim vectors but Claw Studio memory requires 1024/);
  });

  it('throws when embeddingModel is missing', () => {
    expect(() => createClawEmbeddings({ provider: 'bedrock' })).toThrow(/embedding model/i);
  });

  it('throws when Bedrock region is missing', () => {
    expect(() =>
      createClawEmbeddings({ provider: 'bedrock', embeddingModel: 'amazon.titan-embed-text-v2:0' }),
    ).toThrow(/region/i);
  });

  it('builds a Bedrock embeddings instance without explicit credentials — falls back to the AWS SDK default provider chain (SSO/env/instance role), matching model-factory.ts', () => {
    const embeddings = createClawEmbeddings({
      provider: 'bedrock',
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      region: 'ap-south-1',
    });
    expect(embeddings).toBeInstanceOf(BedrockEmbeddings);
  });

  it('throws a clear, fast error for Cohere embedding models — @langchain/aws cannot format their request shape', () => {
    expect(() =>
      createClawEmbeddings({
        provider: 'bedrock',
        embeddingModel: 'cohere.embed-v4:0',
        region: 'us-east-1',
        embeddingDimensions: 1024,
      }),
    ).toThrow(ClawEmbeddingsConfigError);
    expect(() =>
      createClawEmbeddings({ provider: 'bedrock', embeddingModel: 'cohere.embed-v4:0', region: 'us-east-1', embeddingDimensions: 1024 }),
    ).toThrow(/Cohere/);
  });

  it('throws for an unsupported provider', () => {
    expect(() =>
      createClawEmbeddings({ provider: 'not-a-real-provider', embeddingModel: 'foo' }),
    ).toThrow(/unsupported provider/i);
  });
});

describe('dimension guard: a stored dimension must not override a known-model fact', () => {
  // The hosted deployment had embeddingModel `amazon.titan-embed-g1-text-02`
  // with embeddingDimensions hand-set to 1024. G1 only emits 1536 and has no
  // reduction parameter, so validation passed and every memory write then died
  // at Postgres with `expected 1024 dimensions, not 1536`.
  it('rejects a 1536-only model even when embeddingDimensions claims 1024', () => {
    expect(() =>
      createClawEmbeddings({
        provider: 'bedrock',
        region: 'us-east-1',
        embeddingModel: 'amazon.titan-embed-g1-text-02',
        embeddingDimensions: 1024,
      }),
    ).toThrow(/1536|cannot produce|reduction/i);
  });

  it('still accepts a model that natively produces 1024', () => {
    expect(() =>
      createClawEmbeddings({
        provider: 'bedrock',
        region: 'us-east-1',
        embeddingModel: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 1024,
      }),
    ).not.toThrow();
  });
});
