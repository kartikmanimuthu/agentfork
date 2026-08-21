import { describe, it, expect } from 'vitest';
import { pickEmbeddingProvider } from './pick-embedding-provider';

/** Shape of the fields `LlmProviderService.list()` returns that matter here. */
const provider = (over: Partial<Parameters<typeof pickEmbeddingProvider>[0][number]> = {}) => ({
  id: 'p1',
  name: 'provider',
  providerType: 'BEDROCK',
  embeddingModel: 'amazon.titan-embed-text-v2:0',
  embeddingDimensions: 1024,
  ...over,
});

describe('pickEmbeddingProvider', () => {
  // Memory used to resolve off the tenant's DEFAULT (chat) provider, so pointing
  // chat at the self-hosted gateway — which serves no embedding model — took
  // memory down with it: recall threw and was swallowed, save wrote rows with a
  // NULL embedding that the vector search can never return. 244 such rows
  // accumulated. This picks a provider that can actually embed, independently of
  // which one answers chat.
  it('returns null when nothing can embed, rather than a provider that cannot', () => {
    expect(pickEmbeddingProvider([
      provider({ id: 'selfhosted', providerType: 'LITELLM', embeddingModel: null }),
      provider({ id: 'ollama', providerType: 'OLLAMA', embeddingModel: '' }),
    ])).toBeNull();
    expect(pickEmbeddingProvider([])).toBeNull();
  });

  it('skips the chat provider and finds the one that can embed', () => {
    const picked = pickEmbeddingProvider([
      provider({ id: 'selfhosted', providerType: 'LITELLM', embeddingModel: null }),
      provider({ id: 'bedrock' }),
    ]);
    expect(picked?.id).toBe('bedrock');
  });

  // list() already orders isDefault-first, so honouring input order is what makes
  // "prefer the default provider when it is capable" fall out without extra logic.
  it('honours input order, so a capable default wins', () => {
    const picked = pickEmbeddingProvider([provider({ id: 'first' }), provider({ id: 'second' })]);
    expect(picked?.id).toBe('first');
  });

  // titan-embed-g1-text-02 emits 1536 dims and has no dimension parameter, so
  // createClawEmbeddings rejects it outright. Selecting it would swap a clear
  // "nothing can embed" for a confusing runtime throw on every turn.
  it('rejects an embedding model whose dimensions cannot be 1024', () => {
    const picked = pickEmbeddingProvider([
      provider({ id: 'g1', embeddingModel: 'amazon.titan-embed-g1-text-02', embeddingDimensions: 1024 }),
      provider({ id: 'v2' }),
    ]);
    expect(picked?.id).toBe('v2');
  });

  it('rejects Cohere, which the Bedrock embeddings client cannot format', () => {
    expect(pickEmbeddingProvider([
      provider({ id: 'cohere', embeddingModel: 'cohere.embed-english-v3' }),
    ])).toBeNull();
  });

  it('rejects Anthropic, which exposes no embeddings API at all', () => {
    expect(pickEmbeddingProvider([
      provider({ id: 'anthropic', providerType: 'ANTHROPIC', embeddingModel: 'whatever' }),
    ])).toBeNull();
  });

  it('rejects a provider whose declared dimensions are not 1024', () => {
    expect(pickEmbeddingProvider([
      provider({ id: 'wrongdims', embeddingDimensions: 1536 }),
    ])).toBeNull();
  });

  it('accepts a model with a dimension parameter, which can be asked for 1024', () => {
    const picked = pickEmbeddingProvider([
      provider({ id: 'openai', providerType: 'OPENAI', embeddingModel: 'text-embedding-3-large', embeddingDimensions: 1024 }),
    ]);
    expect(picked?.id).toBe('openai');
  });
});
