import { createLogger } from '../logging/logger';

const logger = createLogger('dataset-service');

export interface CreateDatasetInput {
  tenantId: string;
  name: string;
  description?: string;
  metadata?: unknown;
  createdBy: string;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  metadata?: unknown;
}

export interface DatasetDb {
  dataset: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
}

export class DatasetService {
  constructor(private readonly db: DatasetDb) {}

  async create(input: CreateDatasetInput): Promise<unknown> {
    try {
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating dataset');
      return await this.db.dataset.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          metadata: (input.metadata ?? null) as never,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create dataset');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.dataset.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { items: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list datasets');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.dataset.findFirst({
        where: { id, tenantId },
        include: { _count: { select: { items: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get dataset');
      throw error;
    }
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const existing = await this.db.dataset.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Dataset not found');
  }

  async update(tenantId: string, id: string, patch: UpdateDatasetInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Updating dataset');
      return await this.db.dataset.update({
        where: { id },
        data: { ...patch, metadata: (patch.metadata ?? undefined) as never },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update dataset');
      throw error;
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      await this.requireOwned(tenantId, id);
      await this.db.dataset.delete({ where: { id } });
      logger.info({ tenantId, id }, 'Deleted dataset');
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to delete dataset');
      throw error;
    }
  }
}
