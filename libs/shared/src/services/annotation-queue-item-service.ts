import { createLogger } from '../logging/logger';
import { ScoreService, type ScoreDb, type ScoreTargetType } from './score-service';

const logger = createLogger('annotation-queue-item-service');

export interface AnnotationQueueItemDb extends ScoreDb {
  annotationQueue: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<QueueRow | null> };
  annotationQueueItem: {
    createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown; take?: number; skip?: number }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; messageId?: string | null; sessionId?: string | null; executionId?: string | null } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  inferenceSessionMessage: ScoreDb['inferenceSessionMessage'] & {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; session: { tenantId: string } }>>;
  };
  inferenceSession: ScoreDb['inferenceSession'] & {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; tenantId: string }>>;
  };
  apiKeyExecution: ScoreDb['apiKeyExecution'] & {
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; select?: unknown }): Promise<Array<{ id: string; tenantId: string }>>;
  };
  score: ScoreDb['score'];
}

interface QueueRow {
  id: string;
  tenantId: string;
  scoreConfigId: string;
  targetType: ScoreTargetType;
  filters?: { sessionIds?: string[]; messageIds?: string[]; executionIds?: string[]; dateRange?: { from?: string; to?: string } } | null;
}

export interface ReviewQueueItemInput {
  tenantId: string;
  queueId: string;
  itemId: string;
  reviewerUserId: string;
  value?: number | string | boolean;
  comment?: string;
  status?: 'REVIEWED' | 'SKIPPED';
}

export class AnnotationQueueItemService {
  private readonly scoreService: ScoreService;

  constructor(private readonly db: AnnotationQueueItemDb) {
    this.scoreService = new ScoreService(db);
  }

  private async requireQueue(tenantId: string, queueId: string): Promise<QueueRow> {
    const queue = (await this.db.annotationQueue.findFirst({
      where: { id: queueId, tenantId },
      include: { scoreConfig: { select: { dataType: true } } },
    })) as QueueRow | null;
    if (!queue) throw new Error('Queue not found');
    return queue;
  }

  private targetColumns(targetType: ScoreTargetType, targetId: string) {
    if (targetType === 'MESSAGE') return { messageId: targetId, sessionId: null, executionId: null };
    if (targetType === 'SESSION') return { messageId: null, sessionId: targetId, executionId: null };
    return { messageId: null, sessionId: null, executionId: targetId };
  }

  private resolveTargetId(item: { messageId?: string | null; sessionId?: string | null; executionId?: string | null }, targetType: ScoreTargetType): string {
    if (targetType === 'MESSAGE') return item.messageId ?? '';
    if (targetType === 'SESSION') return item.sessionId ?? '';
    return item.executionId ?? '';
  }

  async populate(tenantId: string, queueId: string, limit = 100): Promise<{ count: number }> {
    try {
      const queue = await this.requireQueue(tenantId, queueId);

      let candidates: Array<{ id: string }> = [];
      const take = limit;

      if (queue.targetType === 'MESSAGE') {
        const where: Record<string, unknown> = { session: { tenantId } };
        if (queue.filters?.messageIds?.length) where.id = { in: queue.filters.messageIds };
        if (queue.filters?.dateRange?.from) where.createdAt = { ...(where.createdAt as object || {}), gte: new Date(queue.filters.dateRange.from) };
        if (queue.filters?.dateRange?.to) where.createdAt = { ...(where.createdAt as object || {}), lte: new Date(queue.filters.dateRange.to) };
        candidates = await this.db.inferenceSessionMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      } else if (queue.targetType === 'SESSION') {
        const where: Record<string, unknown> = { tenantId };
        if (queue.filters?.sessionIds?.length) where.id = { in: queue.filters.sessionIds };
        candidates = await this.db.inferenceSession.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      } else {
        const where: Record<string, unknown> = { tenantId };
        if (queue.filters?.executionIds?.length) where.id = { in: queue.filters.executionIds };
        candidates = await this.db.apiKeyExecution.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true } });
      }

      const rows: Record<string, unknown>[] = [];
      for (const c of candidates) {
        const hasScore = await this.db.score.findFirst({
          where: { tenantId, configId: queue.scoreConfigId, ...this.targetColumns(queue.targetType, c.id) },
        });
        const alreadyQueued = await this.db.annotationQueueItem.findFirst({
          where: { queueId, tenantId, ...this.targetColumns(queue.targetType, c.id) },
        });
        if (!hasScore && !alreadyQueued) {
          rows.push({ queueId, tenantId, targetType: queue.targetType, ...this.targetColumns(queue.targetType, c.id), status: 'PENDING' });
        }
      }

      if (rows.length === 0) return { count: 0 };
      const result = await this.db.annotationQueueItem.createMany({ data: rows, skipDuplicates: true });
      logger.info({ tenantId, queueId, count: result.count }, 'Populated annotation queue');
      return { count: result.count };
    } catch (error) {
      logger.error({ err: error, tenantId, queueId }, 'Failed to populate annotation queue');
      throw error;
    }
  }

  async list(tenantId: string, queueId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<unknown[]> {
    try {
      await this.requireQueue(tenantId, queueId);
      const where: Record<string, unknown> = { queueId, tenantId };
      if (opts?.status) where.status = opts.status;
      return await this.db.annotationQueueItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: opts?.limit ?? 50,
        skip: opts?.offset ?? 0,
        include: { message: { select: { role: true, content: true } }, session: { select: { id: true } }, execution: { select: { id: true, input: true, output: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, queueId }, 'Failed to list queue items');
      throw error;
    }
  }

  async review(input: ReviewQueueItemInput): Promise<unknown> {
    try {
      const queue = await this.requireQueue(input.tenantId, input.queueId);
      const item = await this.db.annotationQueueItem.findFirst({ where: { id: input.itemId, queueId: input.queueId, tenantId: input.tenantId } });
      if (!item) throw new Error('Queue item not found');

      let scoreId: string | null = null;
      if (input.status !== 'SKIPPED' && input.value !== undefined) {
        const targetId = this.resolveTargetId(item, queue.targetType);
        if (!targetId) throw new Error('Queue item has no target');
        const score = (await this.scoreService.createManual({
          tenantId: input.tenantId,
          configId: queue.scoreConfigId,
          targetType: queue.targetType,
          targetId,
          value: input.value,
          comment: input.comment,
          authorUserId: input.reviewerUserId,
        })) as { id: string };
        scoreId = score.id;
      }

      logger.info({ tenantId: input.tenantId, queueId: input.queueId, itemId: input.itemId }, 'Reviewed annotation queue item');
      return await this.db.annotationQueueItem.update({
        where: { id: input.itemId },
        data: { status: input.status ?? 'REVIEWED', reviewerUserId: input.reviewerUserId, scoreId, comment: input.comment ?? null },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, queueId: input.queueId, itemId: input.itemId }, 'Failed to review queue item');
      throw error;
    }
  }
}
