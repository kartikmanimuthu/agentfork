import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  llmProvider: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('../db/prisma-client', () => ({
  getPrismaClient: () => mockPrisma,
}));

import { LlmProviderService } from './llm-provider-service';

describe('LlmProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list returns providers ordered by default then createdAt', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findMany.mockResolvedValue([{ id: '1', name: 'Bedrock' }]);
    const result = await service.list();
    expect(mockPrisma.llmProvider.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toEqual([{ id: '1', name: 'Bedrock' }]);
  });

  it('create sets isDefault and clears existing default', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.llmProvider.create.mockResolvedValue({ id: '1' });
    const result = await service.create({ name: 'OpenAI', provider: 'openai', isDefault: true });
    expect(mockPrisma.llmProvider.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isDefault: true },
      data: { isDefault: false },
    });
    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith({
      data: { name: 'OpenAI', provider: 'openai', isDefault: true, tenantId: 't1' },
    });
    expect(result).toEqual({ id: '1' });
  });

  it('getDefaultConfig returns config when default exists', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1',
      provider: 'openai',
      chatModel: 'gpt-4o',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3072,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test',
    });
    const result = await service.getDefaultConfig();
    expect(result).toEqual({
      provider: 'openai',
      chatModel: 'gpt-4o',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3072,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test',
    });
  });

  it('getDefaultConfig returns null when no default exists', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue(null);
    const result = await service.getDefaultConfig();
    expect(result).toBeNull();
  });
});
