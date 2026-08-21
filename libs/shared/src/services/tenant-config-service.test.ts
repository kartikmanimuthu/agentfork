import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  tenantConfig: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('../db/tenant-middleware', () => ({
  getTenantClient: vi.fn(() => mockDb),
}));

import { TenantConfigService } from './tenant-config-service';

describe('TenantConfigService', () => {
  let service: TenantConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TenantConfigService('tenant-1');
  });

  describe('get', () => {
    it('returns config data when found', async () => {
      mockDb.tenantConfig.findFirst.mockResolvedValue({ data: { theme: 'dark' } });
      const result = await service.get('theme');
      expect(result).toEqual({ theme: 'dark' });
      expect(mockDb.tenantConfig.findFirst).toHaveBeenCalledWith({
        where: { configKey: 'theme' },
      });
    });

    it('returns undefined when not found', async () => {
      mockDb.tenantConfig.findFirst.mockResolvedValue(null);
      const result = await service.get('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('upserts config with default updatedBy', async () => {
      mockDb.tenantConfig.upsert.mockResolvedValue({});
      await service.set('theme', { mode: 'dark' });
      expect(mockDb.tenantConfig.upsert).toHaveBeenCalledWith({
        where: { tenantId_configKey: { tenantId: 'tenant-1', configKey: 'theme' } },
        create: { configKey: 'theme', data: { mode: 'dark' }, updatedBy: 'system' },
        update: { data: { mode: 'dark' }, updatedBy: 'system' },
      });
    });

    it('upserts config with custom updatedBy', async () => {
      mockDb.tenantConfig.upsert.mockResolvedValue({});
      await service.set('theme', { mode: 'light' }, 'user-1');
      expect(mockDb.tenantConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ updatedBy: 'user-1' }),
          update: expect.objectContaining({ updatedBy: 'user-1' }),
        }),
      );
    });
  });

  describe('listByPrefix', () => {
    it('queries by configKey prefix and maps rows', async () => {
      const now = new Date('2026-01-01T00:00:00Z');
      mockDb.tenantConfig.findMany.mockResolvedValue([
        { configKey: 'claw-integration-hubspot:account:hub-1', data: { token: 'a' }, updatedAt: now, updatedBy: 'user-1' },
      ]);
      const result = await service.listByPrefix('claw-integration-hubspot:account:');
      expect(mockDb.tenantConfig.findMany).toHaveBeenCalledWith({
        where: { configKey: { startsWith: 'claw-integration-hubspot:account:' } },
        orderBy: { configKey: 'asc' },
      });
      expect(result).toEqual([
        { configKey: 'claw-integration-hubspot:account:hub-1', data: { token: 'a' }, updatedAt: now, updatedBy: 'user-1' },
      ]);
    });

    it('returns an empty array when nothing matches', async () => {
      mockDb.tenantConfig.findMany.mockResolvedValue([]);
      const result = await service.listByPrefix('claw-integration-github:account:');
      expect(result).toEqual([]);
    });
  });
});
