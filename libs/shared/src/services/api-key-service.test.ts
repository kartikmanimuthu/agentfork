import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyService } from './api-key-service';

describe('ApiKeyService', () => {
  const mockDb = {
    apiKey: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'key-1', ...args.data }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({}),
      delete: async () => ({}),
      count: async () => 0,
    },
  };

  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService('tenant-1', mockDb as unknown as Parameters<typeof ApiKeyService>[1]);
  });

  it('should create an API key and return the raw key once', async () => {
    const result = await service.create({
      agentId: 'agent-1',
      name: 'Production Key',
      dailyReqLimit: 500,
      dailyTokenLimit: 50000,
      createdBy: 'user-1',
    });

    expect(result.rawKey).toBeDefined();
    expect(result.rawKey).toMatch(/^sk_[a-zA-Z0-9_-]+$/);
    expect(result.apiKey).toBeDefined();
  });

  it('should validate a key by hash', async () => {
    const { rawKey } = await service.create({
      agentId: 'agent-1',
      name: 'Test Key',
      createdBy: 'user-1',
    });

    mockDb.apiKey.findFirst = async () => ({
      status: 'active',
      expiresAt: null,
    });

    const isValid = await service.validateKey(rawKey);
    expect(isValid).toBe(true);
  });
});
