import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoreConfigService } from './score-config-service';

const mockDb = {
  scoreConfig: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

describe('ScoreConfigService', () => {
  let service: ScoreConfigService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScoreConfigService(mockDb as any);
  });

  it('creates a NUMERIC config', async () => {
    mockDb.scoreConfig.create.mockResolvedValue({ id: 'c1' });
    await service.create({ tenantId: 't1', name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5, createdBy: 'u1' });
    expect(mockDb.scoreConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5, createdBy: 'u1' }),
    });
  });

  it('rejects CATEGORICAL without categories', async () => {
    await expect(
      service.create({ tenantId: 't1', name: 'tone', dataType: 'CATEGORICAL', createdBy: 'u1' }),
    ).rejects.toThrow(/categor/i);
  });

  it('lists non-archived configs by default', async () => {
    mockDb.scoreConfig.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.scoreConfig.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isArchived: false },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('archives a config scoped to tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    mockDb.scoreConfig.update.mockResolvedValue({ id: 'c1', isArchived: true });
    await service.archive('t1', 'c1');
    expect(mockDb.scoreConfig.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isArchived: true } });
  });

  it('throws when archiving a config from another tenant', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(null);
    await expect(service.archive('t1', 'cX')).rejects.toThrow(/not found/i);
  });
});
