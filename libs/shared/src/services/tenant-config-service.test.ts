import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  tenantConfig: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
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
        where: { tenantId_configKey: { tenantId: '', configKey: 'theme' } },
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
});
