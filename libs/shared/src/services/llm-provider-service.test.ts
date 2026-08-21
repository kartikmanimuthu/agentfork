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

const mockGenerateVirtualKey = vi.fn();
const mockRevokeVirtualKey = vi.fn();
const adminClientCtorArgs: unknown[][] = [];

vi.mock('./litellm-admin-client', () => ({
  LiteLLMAdminClient: class {
    constructor(...args: unknown[]) { adminClientCtorArgs.push(args); }
    generateVirtualKey = mockGenerateVirtualKey;
    revokeVirtualKey = mockRevokeVirtualKey;
  },
}));

vi.mock('../env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LITELLM_GATEWAY_URL: 'http://gateway:4000',
    LITELLM_MASTER_KEY: 'sk-master',
  },
}));

import { LlmProviderService, firstChatCapableModel } from './llm-provider-service';

describe('LlmProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateVirtualKey.mockReset();
    mockRevokeVirtualKey.mockReset();
    adminClientCtorArgs.length = 0;
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

  it('create persists discovered models when provided', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.create.mockResolvedValue({ id: '1', name: 'OpenAI', providerType: 'OPENAI', credentials: 'enc:{"apiKey":"sk-test"}', region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, models: { models: [{ id: 'claude-sonnet-4-6-global', name: 'claude-sonnet-4-6-global', capabilities: ['chat'] }] }, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' });

    await service.create({
      name: 'OpenAI', providerType: 'OPENAI', credentials: { apiKey: 'sk-test' },
      models: [{ id: 'claude-sonnet-4-6-global', name: 'claude-sonnet-4-6-global', capabilities: ['chat'] }],
    });

    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        models: { models: [{ id: 'claude-sonnet-4-6-global', name: 'claude-sonnet-4-6-global', capabilities: ['chat'] }] },
      }),
    }));
  });

  it('create stores null models when none are provided', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.create.mockResolvedValue({ id: '1', name: 'OpenAI', providerType: 'OPENAI', credentials: 'enc:{"apiKey":"sk-test"}', region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, models: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' });

    await service.create({ name: 'OpenAI', providerType: 'OPENAI', credentials: { apiKey: 'sk-test' } });

    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ models: null }),
    }));
  });

  it('create provisions a LiteLLM virtual key and stores it as credentials', async () => {
    mockGenerateVirtualKey.mockResolvedValue({ key: 'sk-litellm-generated' });
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.create.mockResolvedValue({
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    });

    const result = await service.create({
      name: 'LiteLLM', providerType: 'LITELLM', credentials: {},
      maxBudgetUsd: 25, chatModel: 'claude-sonnet-4-6-global',
    });

    expect(mockGenerateVirtualKey).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', maxBudgetUsd: 25 })
    );
    expect(adminClientCtorArgs[0]).toEqual(['http://gateway:4000', 'sk-master']);
    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
        externalKeyAlias: expect.stringContaining('tenant-t1-'),
      }),
    }));
    expect(result.credentialsConfigured).toBe(true);
  });

  it('create with custom gatewayUrl/masterKey provisions against the custom gateway and stores it in credentials', async () => {
    mockGenerateVirtualKey.mockResolvedValue({ key: 'sk-litellm-generated' });
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.create.mockResolvedValue({
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated","gatewayUrl":"http://custom:4000","masterKey":"sk-custom"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    });

    await service.create({
      name: 'LiteLLM', providerType: 'LITELLM',
      credentials: { gatewayUrl: 'http://custom:4000', masterKey: 'sk-custom' },
      maxBudgetUsd: 25, chatModel: 'claude-sonnet-4-6-global',
    });

    expect(adminClientCtorArgs[0]).toEqual(['http://custom:4000', 'sk-custom']);
    expect(mockPrisma.llmProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'enc:{"apiKey":"sk-litellm-generated","gatewayUrl":"http://custom:4000","masterKey":"sk-custom"}',
      }),
    }));
  });

  it('create does not write a DB row when LiteLLM key provisioning fails', async () => {
    mockGenerateVirtualKey.mockRejectedValue(new Error('gateway unreachable'));
    const service = new LlmProviderService('t1');

    await expect(
      service.create({ name: 'LiteLLM', providerType: 'LITELLM', credentials: {} })
    ).rejects.toThrow('gateway unreachable');

    expect(mockPrisma.llmProvider.create).not.toHaveBeenCalled();
  });

  it('create does not clear the existing default when LiteLLM key provisioning fails', async () => {
    mockGenerateVirtualKey.mockRejectedValue(new Error('gateway unreachable'));
    const service = new LlmProviderService('t1');

    await expect(
      service.create({ name: 'LiteLLM', providerType: 'LITELLM', credentials: {}, isDefault: true })
    ).rejects.toThrow('gateway unreachable');

    expect(mockPrisma.llmProvider.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.llmProvider.create).not.toHaveBeenCalled();
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

  it('delete revokes the LiteLLM key before removing the row', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', externalKeyAlias: 'tenant-t1-abc', tenantId: 't1',
    });
    mockPrisma.llmProvider.delete.mockResolvedValue({ id: '1' });

    await service.delete('1');

    expect(mockRevokeVirtualKey).toHaveBeenCalledWith('tenant-t1-abc');
    expect(mockPrisma.llmProvider.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('delete revokes against the stored custom gateway, not env', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', externalKeyAlias: 'tenant-t1-abc', tenantId: 't1',
      credentials: 'enc:{"apiKey":"sk-tenant-key","gatewayUrl":"http://custom:4000","masterKey":"sk-custom"}',
    });
    mockPrisma.llmProvider.delete.mockResolvedValue({ id: '1' });

    await service.delete('1');

    expect(adminClientCtorArgs[0]).toEqual(['http://custom:4000', 'sk-custom']);
    expect(mockRevokeVirtualKey).toHaveBeenCalledWith('tenant-t1-abc');
    expect(mockPrisma.llmProvider.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('delete still removes the row if LiteLLM revocation fails', async () => {
    mockRevokeVirtualKey.mockRejectedValue(new Error('gateway unreachable'));
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', externalKeyAlias: 'tenant-t1-abc', tenantId: 't1',
    });
    mockPrisma.llmProvider.delete.mockResolvedValue({ id: '1' });

    await service.delete('1');

    expect(mockPrisma.llmProvider.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('delete does not attempt revocation for non-LiteLLM providers', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'BEDROCK', externalKeyAlias: null, tenantId: 't1',
    });
    mockPrisma.llmProvider.delete.mockResolvedValue({ id: '1' });

    await service.delete('1');

    expect(mockRevokeVirtualKey).not.toHaveBeenCalled();
  });

  it('update does not overwrite stored credentials when input.credentials is an empty object', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing, name: 'Renamed LiteLLM' });

    await service.update('1', { name: 'Renamed LiteLLM', credentials: {} });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credentials: existing.credentials }),
    }));
  });

  it('update overwrites credentials when input.credentials is genuinely populated', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'OpenAI', providerType: 'OPENAI',
      credentials: 'enc:{"apiKey":"sk-old"}',
      externalKeyAlias: null, maxBudgetUsd: null,
      region: null, chatModel: null, embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing, credentials: 'enc:{"apiKey":"new-key"}' });

    await service.update('1', { credentials: { apiKey: 'new-key' } });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credentials: 'enc:{"apiKey":"new-key"}' }),
    }));
  });

  it('update preserves the stored apiKey when only the base URL is retyped', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'ollama-test', providerType: 'OPENAI_COMPATIBLE',
      credentials: 'enc:{"apiKey":"ollama-key","baseUrl":"https://ollama.com"}',
      externalKeyAlias: null, maxBudgetUsd: null,
      region: null, chatModel: 'gpt-oss:20b', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: true,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing });

    await service.update('1', { credentials: { baseUrl: 'https://ollama.com/v1' } });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'enc:{"apiKey":"ollama-key","baseUrl":"https://ollama.com/v1"}',
      }),
    }));
  });

  it('update re-seeds credentials when the stored blob cannot be decrypted', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'ollama-test', providerType: 'OPENAI_COMPATIBLE',
      credentials: 'corrupt-not-decryptable',
      externalKeyAlias: null, maxBudgetUsd: null,
      region: null, chatModel: 'gpt-oss:20b', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing });

    await service.update('1', { credentials: { apiKey: 'fresh-key' } });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credentials: 'enc:{"apiKey":"fresh-key"}' }),
    }));
  });

  it('update merges a new gatewayUrl into the existing LiteLLM credentials blob, preserving apiKey', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing });

    await service.update('1', { credentials: { gatewayUrl: 'http://new:4000' } });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'enc:{"apiKey":"sk-litellm-generated","gatewayUrl":"http://new:4000"}',
      }),
    }));
  });

  it('update does not let the client overwrite the stored apiKey on a LiteLLM row', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing });

    await service.update('1', { credentials: { apiKey: 'evil-key' } });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      }),
    }));
  });

  it('update persists a new maxBudgetUsd value', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue({ ...existing, maxBudgetUsd: 100 });

    await service.update('1', { maxBudgetUsd: 100 });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ maxBudgetUsd: 100 }),
    }));
  });

  it('update preserves existing maxBudgetUsd when omitted from input', async () => {
    const service = new LlmProviderService('t1');
    const existing = {
      id: '1', name: 'LiteLLM', providerType: 'LITELLM',
      credentials: 'enc:{"apiKey":"sk-litellm-generated"}',
      externalKeyAlias: 'tenant-t1-1', maxBudgetUsd: 25,
      region: null, chatModel: 'claude-sonnet-4-6-global', embeddingModel: null,
      embeddingDimensions: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    };
    mockPrisma.llmProvider.findFirst.mockResolvedValue(existing);
    mockPrisma.llmProvider.update.mockResolvedValue(existing);

    await service.update('1', { name: 'Renamed' });

    expect(mockPrisma.llmProvider.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ maxBudgetUsd: 25 }),
    }));
  });

  it('toResponse/list/findById include maxBudgetUsd', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findMany.mockResolvedValue([
      { id: '1', name: 'LiteLLM', providerType: 'LITELLM', credentials: null, region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, maxBudgetUsd: 42, models: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' },
    ]);
    const listResult = await service.list();
    expect(listResult[0].maxBudgetUsd).toBe(42);

    mockPrisma.llmProvider.findFirst.mockResolvedValue(
      { id: '1', name: 'LiteLLM', providerType: 'LITELLM', credentials: null, region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null, maxBudgetUsd: 42, models: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(), tenantId: 't1' }
    );
    const findResult = await service.findById('1');
    expect(findResult?.maxBudgetUsd).toBe(42);
  });

  it('getDefaultConfig injects the gateway baseUrl for LiteLLM providers', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', chatModel: 'claude-sonnet-4-6-global',
      embeddingModel: null, embeddingDimensions: null,
      credentials: 'enc:{"apiKey":"sk-tenant-key"}', region: null, isDefault: true,
    });

    const result = await service.getDefaultConfig();

    expect(result).toEqual(expect.objectContaining({
      provider: 'litellm',
      baseUrl: 'http://gateway:4000',
      apiKey: 'sk-tenant-key',
    }));
  });

  it('getDefaultConfig prefers a stored gatewayUrl over env and never surfaces masterKey', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', chatModel: 'claude-sonnet-4-6-global',
      embeddingModel: null, embeddingDimensions: null,
      credentials: 'enc:{"apiKey":"sk-tenant-key","gatewayUrl":"http://custom:4000","masterKey":"sk-custom"}',
      region: null, isDefault: true,
    });

    const result = await service.getDefaultConfig();

    expect(result).toEqual(expect.objectContaining({
      provider: 'litellm',
      baseUrl: 'http://custom:4000',
      apiKey: 'sk-tenant-key',
    }));
    expect(result).not.toHaveProperty('masterKey');
  });

  it('refreshModels resolves the LiteLLM gateway URL for discovery instead of the raw stored credentials', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', region: null,
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-tenant-virtual-key' }),
    });
    mockPrisma.llmProvider.update.mockResolvedValue({
      id: '1', providerType: 'LITELLM', name: 'LiteLLM',
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-tenant-virtual-key' }),
      region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null,
      maxBudgetUsd: null, externalKeyAlias: 'tenant-t1-abc', models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    });
    const mockDiscover = vi.fn().mockResolvedValue([
      { id: 'claude-sonnet-4-6-global', name: 'claude-sonnet-4-6-global', capabilities: ['chat'] },
    ]);

    await service.refreshModels('1', mockDiscover);

    expect(mockDiscover).toHaveBeenCalledWith(
      'LITELLM',
      { baseUrl: 'http://gateway:4000', apiKey: 'sk-tenant-virtual-key' },
      undefined
    );
  });

  it('refreshModels prefers a stored gatewayUrl over env for LITELLM providers', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'LITELLM', region: null,
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-tenant-virtual-key', gatewayUrl: 'http://custom:4000' }),
    });
    mockPrisma.llmProvider.update.mockResolvedValue({
      id: '1', providerType: 'LITELLM', name: 'LiteLLM',
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-tenant-virtual-key', gatewayUrl: 'http://custom:4000' }),
      region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null,
      maxBudgetUsd: null, externalKeyAlias: 'tenant-t1-abc', models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    });
    const mockDiscover = vi.fn().mockResolvedValue([]);

    await service.refreshModels('1', mockDiscover);

    expect(mockDiscover).toHaveBeenCalledWith(
      'LITELLM',
      { baseUrl: 'http://custom:4000', apiKey: 'sk-tenant-virtual-key' },
      undefined
    );
  });

  it('refreshModels passes stored credentials through unchanged for non-LITELLM providers', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue({
      id: '1', providerType: 'OPENAI', region: null,
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-openai-key' }),
    });
    mockPrisma.llmProvider.update.mockResolvedValue({
      id: '1', providerType: 'OPENAI', name: 'OpenAI',
      credentials: 'enc:' + JSON.stringify({ apiKey: 'sk-openai-key' }),
      region: null, chatModel: null, embeddingModel: null, embeddingDimensions: null,
      maxBudgetUsd: null, externalKeyAlias: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), tenantId: 't1',
    });
    const mockDiscover = vi.fn().mockResolvedValue([]);

    await service.refreshModels('1', mockDiscover);

    expect(mockDiscover).toHaveBeenCalledWith('OPENAI', { apiKey: 'sk-openai-key' }, undefined);
  });
});

describe('firstChatCapableModel', () => {
  // A provider can be saved with no chatModel — the field is
  // `z.string().min(1).optional()` and the form submits undefined when blank. Set
  // that provider as the tenant default and Claw chat threw
  // "createClawModel: chatModel is required on the provider config" on the first
  // message, because an unpinned Claw has no model of its own to fall back to.
  // The user's only way through was to pick a model from the chat dropdown, which
  // supplied it as an override — which is exactly what they should not have to do.
  it('falls back to the first chat-capable discovered model', () => {
    expect(firstChatCapableModel({
      models: [
        { id: 'amazon.titan-embed-text-v2:0', capabilities: ['embedding'] },
        { id: 'us.anthropic.claude-sonnet-5', capabilities: ['chat'] },
      ],
    })).toBe('us.anthropic.claude-sonnet-5');
  });

  it('skips embedding-only models, which cannot hold a conversation', () => {
    expect(firstChatCapableModel({
      models: [{ id: 'amazon.titan-embed-text-v2:0', capabilities: ['embedding'] }],
    })).toBeNull();
  });

  it('accepts a model with no capabilities recorded, as older discovery runs left it empty', () => {
    expect(firstChatCapableModel({ models: [{ id: 'llm-powerhouse-qwen-3-8' }] })).toBe('llm-powerhouse-qwen-3-8');
  });

  it('returns null when there is nothing to fall back to', () => {
    for (const v of [null, undefined, {}, { models: [] }, { models: 'nope' }, 'string']) {
      expect(firstChatCapableModel(v)).toBeNull();
    }
  });

  it('ignores entries with no id, which cannot be sent as a model', () => {
    expect(firstChatCapableModel({ models: [{ name: 'no id here', capabilities: ['chat'] }] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconfiguring an existing provider without re-entering its credentials
// ---------------------------------------------------------------------------

describe('LlmProviderService — editing an existing provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function row(credentials: string | null, overrides: Record<string, unknown> = {}) {
    return {
      id: 'p1', tenantId: 't1', name: 'Self-hosted', providerType: 'OPENAI_COMPATIBLE',
      credentials, region: null, chatModel: 'qwen-3-8', embeddingModel: null,
      embeddingDimensions: null, maxBudgetUsd: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(), ...overrides,
    };
  }

  // The form needs the CURRENT base URL to be able to change it — a blank field
  // means retyping it from memory, which is the bug being fixed.
  it('returns non-secret endpoints so the edit form can prefill them', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue(
      row('enc:{"baseUrl":"http://vllm.internal:8000/v1","apiKey":"sk-secret-value"}'),
    );
    const result = await service.findById('p1');
    expect(result?.endpoints).toEqual({ baseUrl: 'http://vllm.internal:8000/v1' });
  });

  // The whole point: names, never values.
  it('never returns a secret value, only its name', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue(
      row('enc:{"baseUrl":"http://vllm.internal:8000/v1","apiKey":"sk-secret-value"}'),
    );
    const result = await service.findById('p1');
    expect(result?.configuredSecrets).toEqual(['apiKey']);
    expect(JSON.stringify(result)).not.toContain('sk-secret-value');
  });

  // credentialsConfigured only proves the blob decrypted — it reported
  // "Configured" for a provider whose apiKey had been dropped. Per-key is what
  // lets the form decide which fields are safe to leave blank.
  it('reports an empty secret list when the blob decrypts but holds no secret', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue(row('enc:{"baseUrl":"http://vllm.internal:8000/v1"}'));
    const result = await service.findById('p1');
    expect(result?.credentialsConfigured).toBe(true);
    expect(result?.configuredSecrets).toEqual([]);
  });

  it('reports no endpoints and no secrets for a provider with no credentials at all', async () => {
    const service = new LlmProviderService('t1');
    mockPrisma.llmProvider.findFirst.mockResolvedValue(row(null));
    const result = await service.findById('p1');
    expect(result?.endpoints).toEqual({});
    expect(result?.configuredSecrets).toEqual([]);
  });

  describe('mergeStoredCredentials', () => {
    // The exact failing scenario from the bug report: change the URL, keep the key.
    it('keeps the stored API key when only the base URL was retyped', async () => {
      const service = new LlmProviderService('t1');
      mockPrisma.llmProvider.findFirst.mockResolvedValue(
        row('enc:{"baseUrl":"http://old:8000/v1","apiKey":"sk-stored"}'),
      );
      await expect(service.mergeStoredCredentials('p1', { baseUrl: 'http://new:8000/v1' })).resolves.toEqual({
        baseUrl: 'http://new:8000/v1',
        apiKey: 'sk-stored',
      });
    });

    // An untouched secret field submits '' — that must not erase the real key.
    it('ignores blank submitted values instead of blanking a stored secret', async () => {
      const service = new LlmProviderService('t1');
      mockPrisma.llmProvider.findFirst.mockResolvedValue(
        row('enc:{"baseUrl":"http://old:8000/v1","apiKey":"sk-stored"}'),
      );
      await expect(
        service.mergeStoredCredentials('p1', { apiKey: '', baseUrl: 'http://new:8000/v1' }),
      ).resolves.toEqual({ baseUrl: 'http://new:8000/v1', apiKey: 'sk-stored' });
    });

    it('lets a retyped secret win over the stored one', async () => {
      const service = new LlmProviderService('t1');
      mockPrisma.llmProvider.findFirst.mockResolvedValue(row('enc:{"apiKey":"sk-stored"}'));
      await expect(service.mergeStoredCredentials('p1', { apiKey: 'sk-new' })).resolves.toEqual({ apiKey: 'sk-new' });
    });

    // The id comes from the browser, so a miss must not reach another tenant's
    // credentials — findFirst is tenant-scoped and a miss degrades to what was sent.
    it('falls back to the submitted values when the provider is not this tenant’s', async () => {
      const service = new LlmProviderService('t1');
      mockPrisma.llmProvider.findFirst.mockResolvedValue(null);
      await expect(service.mergeStoredCredentials('other-tenant-provider', { apiKey: 'sk-typed' })).resolves.toEqual({
        apiKey: 'sk-typed',
      });
      expect(mockPrisma.llmProvider.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'other-tenant-provider', tenantId: 't1' } }),
      );
    });

    it('treats an undecryptable blob as empty rather than throwing', async () => {
      const service = new LlmProviderService('t1');
      mockPrisma.llmProvider.findFirst.mockResolvedValue(row('not-decryptable'));
      await expect(service.mergeStoredCredentials('p1', { apiKey: 'sk-typed' })).resolves.toEqual({ apiKey: 'sk-typed' });
    });
  });
});

describe('LlmProviderService.findById — returning secrets for the edit form', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function providerRow(credentials: string | null) {
    return {
      id: 'p1', tenantId: 't1', name: 'ollama-test', providerType: 'OLLAMA',
      credentials, region: null, chatModel: 'gpt-oss:120b', embeddingModel: null,
      embeddingDimensions: null, maxBudgetUsd: null, models: null, isDefault: false,
      createdAt: new Date(), updatedAt: new Date(),
    };
  }

  // Opt-in: the default response must stay secret-free, so the list page and the
  // detail view never carry credentials they have no use for.
  it('omits secrets unless asked', async () => {
    mockPrisma.llmProvider.findFirst.mockResolvedValue(providerRow('enc:{"apiKey":"sk-real-key","baseUrl":"https://ollama.com/v1"}'));
    const result = await new LlmProviderService('t1').findById('p1');
    expect(result?.secrets).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sk-real-key');
  });

  // What the operator asked for: see and edit the key already entered.
  it('returns the saved secrets when asked', async () => {
    mockPrisma.llmProvider.findFirst.mockResolvedValue(providerRow('enc:{"apiKey":"sk-real-key","baseUrl":"https://ollama.com/v1"}'));
    const result = await new LlmProviderService('t1').findById('p1', { includeSecrets: true });
    expect(result?.secrets).toEqual({ apiKey: 'sk-real-key' });
  });

  // Endpoints are not secrets and already travel in `endpoints`; duplicating them
  // here would just be a second copy to keep in step.
  it('returns only secret keys, not endpoints', async () => {
    mockPrisma.llmProvider.findFirst.mockResolvedValue(
      providerRow('enc:{"apiKey":"sk-real-key","baseUrl":"https://ollama.com/v1","gatewayUrl":"http://gw:4000"}'),
    );
    const result = await new LlmProviderService('t1').findById('p1', { includeSecrets: true });
    expect(Object.keys(result!.secrets!)).toEqual(['apiKey']);
    expect(result?.endpoints).toEqual({ baseUrl: 'https://ollama.com/v1', gatewayUrl: 'http://gw:4000' });
  });

  it('returns an empty secrets map for a provider with no credentials', async () => {
    mockPrisma.llmProvider.findFirst.mockResolvedValue(providerRow(null));
    const result = await new LlmProviderService('t1').findById('p1', { includeSecrets: true });
    expect(result?.secrets).toEqual({});
  });

  // Tenant scoping is unchanged by the new option — a provider in another tenant
  // must not become reachable just because secrets were requested.
  it('stays tenant-scoped when returning secrets', async () => {
    mockPrisma.llmProvider.findFirst.mockResolvedValue(null);
    await expect(new LlmProviderService('t1').findById('p1', { includeSecrets: true })).resolves.toBeNull();
    expect(mockPrisma.llmProvider.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', tenantId: 't1' } });
  });
});
