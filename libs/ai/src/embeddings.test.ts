import { describe, it, expect, vi } from 'vitest';
import { generateEmbedding, generateEmbeddings } from './embeddings';
import type { LLMProvider } from './provider';

const createMockProvider = (): LLMProvider => ({
  name: 'mock',
  chatModel: 'mock-model',
  embeddingModel: 'mock-embedding',
  embeddingDimensions: 1024,
  streamChat: vi.fn(),
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]),
});

describe('generateEmbedding', () => {
  it('delegates to provider.embed', async () => {
    const provider = createMockProvider();
    const result = await generateEmbedding('hello world', provider);
    expect(provider.embed).toHaveBeenCalledWith('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('generateEmbeddings', () => {
  it('delegates to provider.embedBatch', async () => {
    const provider = createMockProvider();
    const result = await generateEmbeddings(['hello', 'world'], provider);
    expect(provider.embedBatch).toHaveBeenCalledWith(['hello', 'world']);
    expect(result).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
  });
});
