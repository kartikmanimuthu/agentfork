import { createLogger } from '../logging/logger';
import type { ScoreTargetType } from './score-service';

const logger = createLogger('annotation-queue-service');

export interface CreateAnnotationQueueInput {
  tenantId: string;
  name: string;
  description?: string;
  scoreConfigId: string;
  targetType: ScoreTargetType;
  filters?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateAnnotationQueueInput {
  name?: string;
  description?: string;
  scoreConfigId?: string;
  targetType?: ScoreTargetType;
  filters?: Record<string, unknown>;
  isActive?: boolean;
}

export interface AnnotationQueueDb {
  annotationQueue: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

export class AnnotationQueueService {
  constructor(private readonly db: AnnotationQueueDb) {}

  private async requireScoreConfig(tenantId: string, scoreConfigId: string): Promise<void> {
    const cfg = await this.db.scoreConfig.findFirst({ where: { id: scoreConfigId, tenantId } });
    if (!cfg) throw new Error('Score config not found');
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const q = await this.db.annotationQueue.findFirst({ where: { id, tenantId } });
    if (!q) throw new Error('Queue not found');
  }

  async create(input: CreateAnnotationQueueInput): Promise<unknown> {
    try {
      await this.requireScoreConfig(input.tenantId, input.scoreConfigId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating annotation queue');
      return await this.db.annotationQueue.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          scoreConfigId: input.scoreConfigId,
          targetType: input.targetType,
          filters: input.filters ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create annotation queue');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.annotationQueue.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true } }, _count: { select: { items: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list annotation queues');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.annotationQueue.findFirst({
        where: { id, tenantId },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true, categories: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get annotation queue');
      throw error;
    }
  }

  async update(tenantId: string, id: string, patch: UpdateAnnotationQueueInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      if (patch.scoreConfigId) await this.requireScoreConfig(tenantId, patch.scoreConfigId);
      logger.info({ tenantId, id }, 'Updating annotation queue');
      return await this.db.annotationQueue.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update annotation queue');
      throw error;
    }
  }

  async disable(tenantId: string, id: string): Promise<unknown> {
    return this.update(tenantId, id, { isActive: false });
  }
}
