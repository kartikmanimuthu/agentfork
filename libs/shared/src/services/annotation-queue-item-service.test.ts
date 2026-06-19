import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnnotationQueueItemService } from './annotation-queue-item-service';

const mockDb = {
  annotationQueue: {
    findFirst: vi.fn(),
  },
  annotationQueueItem: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  score: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
  },
  scoreConfig: {
    findFirst: vi.fn(),
  },
  inferenceSessionMessage: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  inferenceSession: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  apiKeyExecution: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('AnnotationQueueItemService', () => {
  let service: AnnotationQueueItemService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnnotationQueueItemService(mockDb as any);
  });

  it('populates pending MESSAGE items', async () => {
    mockDb.annotationQueue.findFirst.mockResolvedValue({ id: 'q1', tenantId: 't1', scoreConfigId: 'c1', targetType: 'MESSAGE' });
    mockDb.inferenceSessionMessage.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.annotationQueueItem.findFirst.mockResolvedValue(null);
    mockDb.annotationQueueItem.createMany.mockResolvedValue({ count: 2 });

    const result = await service.populate('t1', 'q1', 10);
    expect(result).toEqual({ count: 2 });
    expect(mockDb.annotationQueueItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ queueId: 'q1', tenantId: 't1', targetType: 'MESSAGE', messageId: 'm1', status: 'PENDING' }),
      ]),
      skipDuplicates: true,
    });
  });

  it('skips items that already have a score', async () => {
    mockDb.annotationQueue.findFirst.mockResolvedValue({ id: 'q1', tenantId: 't1', scoreConfigId: 'c1', targetType: 'MESSAGE' });
    mockDb.inferenceSessionMessage.findMany.mockResolvedValue([{ id: 'm1' }]);
    mockDb.score.findFirst.mockResolvedValue({ id: 's1' });

    const result = await service.populate('t1', 'q1', 10);
    expect(result).toEqual({ count: 0 });
    expect(mockDb.annotationQueueItem.createMany).not.toHaveBeenCalled();
  });

  it('reviews a pending item and creates a manual score', async () => {
    mockDb.annotationQueue.findFirst.mockResolvedValue({ id: 'q1', tenantId: 't1', scoreConfigId: 'c1', targetType: 'MESSAGE' });
    mockDb.annotationQueueItem.findFirst.mockResolvedValue({ id: 'qi1', messageId: 'm1' });
    mockDb.scoreConfig.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', dataType: 'NUMERIC', minValue: 1, maxValue: 5, categories: null, isArchived: false });
    mockDb.inferenceSessionMessage.findFirst.mockResolvedValue({ id: 'm1', session: { tenantId: 't1' } });
    mockDb.score.findFirst.mockResolvedValue(null);
    mockDb.score.create.mockResolvedValue({ id: 's1' });

    await service.review({ tenantId: 't1', queueId: 'q1', itemId: 'qi1', reviewerUserId: 'u1', value: 4, comment: 'good' });

    expect(mockDb.annotationQueueItem.update).toHaveBeenCalledWith({
      where: { id: 'qi1' },
      data: expect.objectContaining({ status: 'REVIEWED', reviewerUserId: 'u1', scoreId: 's1', comment: 'good' }),
    });
  });

  it('skips an item without creating a score', async () => {
    mockDb.annotationQueue.findFirst.mockResolvedValue({ id: 'q1', tenantId: 't1', scoreConfigId: 'c1', targetType: 'MESSAGE' });
    mockDb.annotationQueueItem.findFirst.mockResolvedValue({ id: 'qi1', messageId: 'm1' });

    await service.review({ tenantId: 't1', queueId: 'q1', itemId: 'qi1', reviewerUserId: 'u1', status: 'SKIPPED' });

    expect(mockDb.score.create).not.toHaveBeenCalled();
    expect(mockDb.annotationQueueItem.update).toHaveBeenCalledWith({
      where: { id: 'qi1' },
      data: expect.objectContaining({ status: 'SKIPPED', scoreId: null }),
    });
  });
});
