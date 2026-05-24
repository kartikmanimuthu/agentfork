import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SdkWidgetService } from './sdk-widget-service';

const mockDb = {
  sdkWidget: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

describe('SdkWidgetService', () => {
  let service: SdkWidgetService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SdkWidgetService('tenant-1', mockDb as any);
  });

  describe('create', () => {
    it('generates a unique sdkId and creates widget', async () => {
      mockDb.sdkWidget.create.mockResolvedValue({ id: 'w1', sdkId: 'sdk_abc123' });

      const result = await service.create({
        agentId: 'agent-1',
        apiKeyId: 'key-1',
        name: 'Support Widget',
      });

      expect(mockDb.sdkWidget.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          agentId: 'agent-1',
          apiKeyId: 'key-1',
          name: 'Support Widget',
          sdkId: expect.stringMatching(/^sdk_[a-f0-9]{12}$/),
        }),
      });
      expect(result).toEqual({ id: 'w1', sdkId: 'sdk_abc123' });
    });
  });

  describe('findBySdkId', () => {
    it('returns widget with agent and apiKey included', async () => {
      mockDb.sdkWidget.findFirst.mockResolvedValue({ id: 'w1', sdkId: 'sdk_abc', status: 'active' });

      const result = await service.findBySdkId('sdk_abc');

      expect(mockDb.sdkWidget.findFirst).toHaveBeenCalledWith({
        where: { sdkId: 'sdk_abc', status: 'active' },
        include: { agent: true, apiKey: true },
      });
      expect(result).toEqual({ id: 'w1', sdkId: 'sdk_abc', status: 'active' });
    });

    it('returns null for non-existent sdkId', async () => {
      mockDb.sdkWidget.findFirst.mockResolvedValue(null);
      const result = await service.findBySdkId('sdk_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates widget fields', async () => {
      mockDb.sdkWidget.update.mockResolvedValue({ id: 'w1', primaryColor: '#ff0000' });

      const result = await service.update('w1', { primaryColor: '#ff0000' });

      expect(mockDb.sdkWidget.update).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { primaryColor: '#ff0000' },
      });
      expect(result).toEqual({ id: 'w1', primaryColor: '#ff0000' });
    });
  });

  describe('listByTenant', () => {
    it('returns all widgets for tenant', async () => {
      mockDb.sdkWidget.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);

      const result = await service.listByTenant();

      expect(mockDb.sdkWidget.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });
});
