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

vi.mock('./encryption-service', () => ({
  EncryptionService: class {
    encrypt = vi.fn((p: string) => `enc:${p}`);
    decrypt = vi.fn((c: string) => c.replace('enc:', ''));
  },
}));

import { LlmProviderService } from './llm-provider-service';

describe('LlmProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list returns providers with masked credentials', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findMany.mockResolvedValue([
      { id: '1', name: 'Bedrock', providerType: 'BEDROCK', credentials: 'enc:{"accessKeyId":"AKIA123"}', region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, models: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' },
    ]);
    const result = await service.list();
    expect(result[0].credentialsConfigured).toBe(true);
    expect(result[0].credentialsHint).toBe('AKI...123');
  });

  it('create encrypts credentials', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.create.mockResolvedValue({ id: '1', name: 'OpenAI', providerType: 'OPENAI', credentials: 'enc:{"apiKey":"sk-test"}', region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, models: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' });
    const result = await service.create({ name: 'OpenAI', providerType: 'OPENAI', credentials: { apiKey: 'sk-test' } });
    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credentials: 'enc:{"apiKey":"sk-test"}' }),
    }));
    expect(result.credentialsConfigured).toBe(true);
  });

  it('getDefaultConfig decrypts credentials', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1',
      providerType: 'OPENAI',
      chatModel: 'gpt-4o',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3072,
      credentials: 'enc:{"apiKey":"sk-test","baseUrl":"http://localhost:11434/v1"}',
      region: null,
      isDefault: true,
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

  it('validateAndDiscoverModels returns discovered models via callback', async () => {
    const service = new LlmProviderService('t1');
    const mockDiscover = vi.fn().mockResolvedValue([{ id: 'gpt-4', name: 'GPT-4', capabilities: ['chat'] }]);
    const result = await service.validateAndDiscoverModels({
      providerType: 'OPENAI',
      credentials: { apiKey: 'sk-test' },
    }, mockDiscover);
    expect(result.success).toBe(true);
    expect(result.models).toEqual([{ id: 'gpt-4', name: 'GPT-4', capabilities: ['chat'] }]);
    expect(mockDiscover).toHaveBeenCalledWith('OPENAI', { apiKey: 'sk-test' }, undefined);
  });
});
