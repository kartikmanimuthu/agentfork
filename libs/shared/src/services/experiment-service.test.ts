import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperimentService } from './experiment-service';

const mockDb = {
  experiment: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  dataset: {
    findFirst: vi.fn(),
  },
};

describe('ExperimentService', () => {
  let service: ExperimentService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExperimentService(mockDb as any);
  });

  it('creates an experiment scoped to a dataset', async () => {
    mockDb.dataset.findFirst.mockResolvedValue({ id: 'd1', tenantId: 't1' });
    mockDb.experiment.create.mockResolvedValue({ id: 'e1' });
    await service.create({
      tenantId: 't1',
      name: 'Compare v1 and v2',
      datasetId: 'd1',
      agentVersionIds: ['v1', 'v2'],
      scoreConfigIds: ['c1'],
      createdBy: 'u1',
    });
    expect(mockDb.experiment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'Compare v1 and v2', datasetId: 'd1', agentVersionIds: ['v1', 'v2'], scoreConfigIds: ['c1'], createdBy: 'u1' }),
    });
  });

  it('throws when dataset is missing', async () => {
    mockDb.dataset.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ tenantId: 't1', name: 'x', datasetId: 'd1', agentVersionIds: ['v1'], scoreConfigIds: ['c1'], createdBy: 'u1' }),
    ).rejects.toThrow(/not found/i);
  });

  it('lists experiments with dataset and run item counts', async () => {
    mockDb.experiment.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.experiment.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      orderBy: { createdAt: 'desc' },
      include: { dataset: { select: { id: true, name: true } }, _count: { select: { runItems: true } } },
    });
  });

  it('deletes an experiment scoped to tenant', async () => {
    mockDb.experiment.findFirst.mockResolvedValue({ id: 'e1' });
    await service.delete('t1', 'e1');
    expect(mockDb.experiment.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
  });
});
