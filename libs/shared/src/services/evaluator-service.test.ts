import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluatorService } from './evaluator-service';

const mockDb = {
  evaluator: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  scoreConfig: {
    findFirst: vi.fn(),
  },
};

describe('EvaluatorService', () => {
  let service: EvaluatorService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new EvaluatorService(mockDb as any);
  });

  it('creates an evaluator scoped to a score config', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', dataType: 'NUMERIC' });
    mockDb.evaluator.create.mockResolvedValue({ id: 'e1' });
    await service.create({
      tenantId: 't1',
      name: 'Helpfulness',
      scoreConfigId: 'c1',
      prompt: 'Rate helpfulness 1-5',
      createdBy: 'u1',
    });
    expect(mockDb.evaluator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'Helpfulness', scoreConfigId: 'c1', prompt: 'Rate helpfulness 1-5', createdBy: 'u1' }),
    });
  });

  it('throws when score config is missing', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ tenantId: 't1', name: 'Helpfulness', scoreConfigId: 'c1', prompt: 'x', createdBy: 'u1' }),
    ).rejects.toThrow(/not found/i);
  });

  it('lists active evaluators for a tenant', async () => {
    mockDb.evaluator.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.evaluator.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { scoreConfig: { select: { id: true, name: true, dataType: true } } },
    });
  });

  it('gets an evaluator with score config categories', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({ id: 'e1' });
    await service.get('t1', 'e1');
    expect(mockDb.evaluator.findFirst).toHaveBeenCalledWith({
      where: { id: 'e1', tenantId: 't1' },
      include: { scoreConfig: { select: { id: true, name: true, dataType: true, categories: true } } },
    });
  });

  it('updates an evaluator scoped to tenant', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({ id: 'e1' });
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c2', tenantId: 't1', dataType: 'NUMERIC' });
    mockDb.evaluator.update.mockResolvedValue({ id: 'e1', name: 'Updated' });
    await service.update('t1', 'e1', { name: 'Updated', scoreConfigId: 'c2' });
    expect(mockDb.evaluator.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { name: 'Updated', scoreConfigId: 'c2' } });
  });

  it('disables an evaluator', async () => {
    mockDb.evaluator.findFirst.mockResolvedValue({ id: 'e1' });
    mockDb.evaluator.update.mockResolvedValue({ id: 'e1', isActive: false });
    await service.disable('t1', 'e1');
    expect(mockDb.evaluator.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { isActive: false } });
  });
});
