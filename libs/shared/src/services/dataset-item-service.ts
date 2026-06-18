import { createLogger } from '../logging/logger';
import type { ScoreTargetType } from './score-service';

const logger = createLogger('dataset-item-service');

export interface CreateDatasetItemInput {
  input: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
  sourceMessageId?: string;
  sourceSessionId?: string;
  createdBy: string;
}

export interface UpdateDatasetItemInput {
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface AddFromTraceInput {
  tenantId: string;
  datasetId: string;
  targetType: ScoreTargetType;
  targetId: string;
  createdBy: string;
}

export interface DatasetItemDb {
  dataset: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
  datasetItem: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  inferenceSessionMessage: {
    findFirst(args: {
      where: Record<string, unknown>;
      include?: unknown;
    }): Promise<{ id: string; role: string; content: string; session: { tenantId: string } } | null>;
  };
  inferenceSession: {
    findFirst(args: {
      where: Record<string, unknown>;
      include?: unknown;
    }): Promise<{ id: string; tenantId: string; messages?: Array<{ role: string; content: string }> } | null>;
  };
}

export class DatasetItemService {
  constructor(private readonly db: DatasetItemDb) {}

  private async requireDataset(tenantId: string, datasetId: string): Promise<void> {
    const ds = await this.db.dataset.findFirst({ where: { id: datasetId, tenantId } });
    if (!ds) throw new Error('Dataset not found');
  }

  async create(tenantId: string, datasetId: string, input: CreateDatasetItemInput): Promise<unknown> {
    try {
      await this.requireDataset(tenantId, datasetId);
      logger.info({ tenantId, datasetId }, 'Creating dataset item');
      return await this.db.datasetItem.create({
        data: {
          datasetId,
          input: input.input as never,
          expectedOutput: (input.expectedOutput ?? null) as never,
          metadata: (input.metadata ?? null) as never,
          sourceMessageId: input.sourceMessageId ?? null,
          sourceSessionId: input.sourceSessionId ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId }, 'Failed to create dataset item');
      throw error;
    }
  }

  async bulkCreate(
    tenantId: string,
    datasetId: string,
    rows: CreateDatasetItemInput[],
    createdBy: string,
  ): Promise<{ count: number }> {
    try {
      await this.requireDataset(tenantId, datasetId);
      logger.info({ tenantId, datasetId, count: rows.length }, 'Bulk-creating dataset items');
      return await this.db.datasetItem.createMany({
        data: rows.map((r) => ({
          datasetId,
          input: r.input as never,
          expectedOutput: (r.expectedOutput ?? null) as never,
          metadata: (r.metadata ?? null) as never,
          createdBy,
        })),
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId }, 'Failed to bulk-create dataset items');
      throw error;
    }
  }

  async addFromTrace(input: AddFromTraceInput): Promise<unknown> {
    try {
      await this.requireDataset(input.tenantId, input.datasetId);
      if (input.targetType === 'MESSAGE') {
        const msg = await this.db.inferenceSessionMessage.findFirst({
          where: { id: input.targetId },
          include: { session: { select: { tenantId: true } } },
        });
        if (!msg || msg.session.tenantId !== input.tenantId) {
          throw new Error('Trace message not found in tenant');
        }
        return await this.create(input.tenantId, input.datasetId, {
          input: { role: msg.role, content: msg.content },
          expectedOutput: msg.role === 'assistant' ? { content: msg.content } : null,
          sourceMessageId: msg.id,
          createdBy: input.createdBy,
        });
      }
      // SESSION
      const session = await this.db.inferenceSession.findFirst({
        where: { id: input.targetId, tenantId: input.tenantId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!session) throw new Error('Trace session not found in tenant');
      const msgs = session.messages ?? [];
      const firstUser = msgs.find((m) => m.role === 'user');
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      return await this.create(input.tenantId, input.datasetId, {
        input: { content: firstUser?.content ?? '' },
        expectedOutput: lastAssistant ? { content: lastAssistant.content } : null,
        sourceSessionId: session.id,
        createdBy: input.createdBy,
      });
    } catch (error) {
      logger.error(
        { err: error, tenantId: input.tenantId, datasetId: input.datasetId },
        'Failed to add item from trace',
      );
      throw error;
    }
  }

  async list(tenantId: string, datasetId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]> {
    try {
      await this.requireDataset(tenantId, datasetId);
      const where: Record<string, unknown> = { datasetId };
      if (!opts?.includeArchived) where['status'] = 'ACTIVE';
      return this.db.datasetItem.findMany({ where, orderBy: { createdAt: 'desc' } });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId }, 'Failed to list dataset items');
      throw error;
    }
  }

  private async requireItem(tenantId: string, datasetId: string, itemId: string): Promise<void> {
    await this.requireDataset(tenantId, datasetId);
    const item = await this.db.datasetItem.findFirst({ where: { id: itemId, datasetId } });
    if (!item) throw new Error('Dataset item not found');
  }

  async update(tenantId: string, datasetId: string, itemId: string, patch: UpdateDatasetItemInput): Promise<unknown> {
    try {
      await this.requireItem(tenantId, datasetId, itemId);
      logger.info({ tenantId, datasetId, itemId }, 'Updating dataset item');
      return await this.db.datasetItem.update({
        where: { id: itemId },
        data: {
          ...(patch.input !== undefined ? { input: patch.input as never } : {}),
          ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput as never } : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata as never } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId, itemId }, 'Failed to update dataset item');
      throw error;
    }
  }

  async archive(tenantId: string, datasetId: string, itemId: string): Promise<unknown> {
    return this.update(tenantId, datasetId, itemId, { status: 'ARCHIVED' });
  }

  async delete(tenantId: string, datasetId: string, itemId: string): Promise<void> {
    try {
      await this.requireItem(tenantId, datasetId, itemId);
      await this.db.datasetItem.delete({ where: { id: itemId } });
      logger.info({ tenantId, datasetId, itemId }, 'Deleted dataset item');
    } catch (error) {
      logger.error({ err: error, tenantId, datasetId, itemId }, 'Failed to delete dataset item');
      throw error;
    }
  }
}
