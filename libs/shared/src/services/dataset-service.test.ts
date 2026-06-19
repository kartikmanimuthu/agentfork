import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatasetService } from './dataset-service';

const mockDb = {
  dataset: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
};

describe('DatasetService', () => {
  let service: DatasetService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new DatasetService(mockDb as any);
  });

  it('creates a dataset', async () => {
    mockDb.dataset.create.mockResolvedValue({ id: 'd1' });
    await service.create({ tenantId: 't1', name: 'Regression set', createdBy: 'u1' });
    expect(mockDb.dataset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'Regression set', createdBy: 'u1' }),
    });
  });

  it('lists datasets with item counts', async () => {
    mockDb.dataset.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.dataset.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  });

  it('throws deleting a dataset from another tenant', async () => {
    mockDb.dataset.findFirst.mockResolvedValue(null);
    await expect(service.delete('t1', 'dX')).rejects.toThrow(/not found/i);
  });
});
