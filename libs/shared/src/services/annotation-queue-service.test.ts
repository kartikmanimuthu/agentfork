import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnnotationQueueService } from './annotation-queue-service';

const mockDb = {
  annotationQueue: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  scoreConfig: {
    findFirst: vi.fn(),
  },
};

describe('AnnotationQueueService', () => {
  let service: AnnotationQueueService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnnotationQueueService(mockDb as any);
  });

  it('creates a queue scoped to a score config', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' });
    mockDb.annotationQueue.create.mockResolvedValue({ id: 'q1' });
    await service.create({
      tenantId: 't1',
      name: 'Review helpfulness',
      scoreConfigId: 'c1',
      targetType: 'MESSAGE',
      createdBy: 'u1',
    });
    expect(mockDb.annotationQueue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', name: 'Review helpfulness', scoreConfigId: 'c1', targetType: 'MESSAGE', createdBy: 'u1' }),
    });
  });

  it('throws when score config is missing', async () => {
    mockDb.scoreConfig.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ tenantId: 't1', name: 'Review', scoreConfigId: 'c1', targetType: 'MESSAGE', createdBy: 'u1' }),
    ).rejects.toThrow(/not found/i);
  });

  it('lists active queues with item counts', async () => {
    mockDb.annotationQueue.findMany.mockResolvedValue([]);
    await service.list('t1');
    expect(mockDb.annotationQueue.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { scoreConfig: { select: { id: true, name: true, dataType: true } }, _count: { select: { items: true } } },
    });
  });

  it('disables a queue scoped to tenant', async () => {
    mockDb.annotationQueue.findFirst.mockResolvedValue({ id: 'q1' });
    mockDb.annotationQueue.update.mockResolvedValue({ id: 'q1', isActive: false });
    await service.disable('t1', 'q1');
    expect(mockDb.annotationQueue.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { isActive: false } });
  });
});
