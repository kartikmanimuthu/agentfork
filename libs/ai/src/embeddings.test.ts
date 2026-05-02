import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEmbed, mockEmbedMany } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbedMany: vi.fn(),
}));

vi.mock('ai', () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
}));

vi.mock('./bedrock-client', () => {
  const provider = (model: string) => ({ modelId: model });
  provider.textEmbeddingModel = (model: string) => ({ modelId: model, type: 'embedding' });
  return {
    getBedrockProvider: vi.fn(() => provider),
    DEFAULT_MODEL: 'anthropic.claude-sonnet-4-20250514',
  };
});

import { generateEmbedding, generateEmbeddings } from './embeddings';

describe('generateEmbedding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns embedding vector for a single text', async () => {
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    const result = await generateEmbedding('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbed).toHaveBeenCalledWith({
      model: { modelId: 'amazon.titan-embed-text-v2:0', type: 'embedding' },
      value: 'hello world',
    });
  });
});

describe('generateEmbeddings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns embedding vectors for multiple texts', async () => {
    mockEmbedMany.mockResolvedValue({
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
    });
    const result = await generateEmbeddings(['hello', 'world']);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(mockEmbedMany).toHaveBeenCalledWith({
      model: { modelId: 'amazon.titan-embed-text-v2:0', type: 'embedding' },
      values: ['hello', 'world'],
    });
  });

  it('handles empty array', async () => {
    mockEmbedMany.mockResolvedValue({ embeddings: [] });
    const result = await generateEmbeddings([]);
    expect(result).toEqual([]);
  });
});
