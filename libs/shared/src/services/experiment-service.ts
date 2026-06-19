import { createLogger } from '../logging/logger';

const logger = createLogger('experiment-service');

export interface CreateExperimentInput {
  tenantId: string;
  name: string;
  description?: string;
  datasetId: string;
  agentVersionIds: string[];
  scoreConfigIds: string[];
  metadata?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateExperimentInput {
  name?: string;
  description?: string;
  datasetId?: string;
  agentVersionIds?: string[];
  scoreConfigIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExperimentDb {
  experiment: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  dataset: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

export class ExperimentService {
  constructor(private readonly db: ExperimentDb) {}

  private async requireDataset(tenantId: string, datasetId: string): Promise<void> {
    const ds = await this.db.dataset.findFirst({ where: { id: datasetId, tenantId } });
    if (!ds) throw new Error('Dataset not found');
  }

  async create(input: CreateExperimentInput): Promise<unknown> {
    try {
      await this.requireDataset(input.tenantId, input.datasetId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating experiment');
      return await this.db.experiment.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          datasetId: input.datasetId,
          agentVersionIds: input.agentVersionIds,
          scoreConfigIds: input.scoreConfigIds,
          metadata: input.metadata ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create experiment');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.experiment.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { dataset: { select: { id: true, name: true } }, _count: { select: { runItems: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list experiments');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.experiment.findFirst({
        where: { id, tenantId },
        include: {
          dataset: { include: { _count: { select: { items: true } } } },
          runItems: { orderBy: { createdAt: 'asc' }, include: { agentVersion: { select: { version: true, agentId: true } }, datasetItem: { select: { input: true } } } },
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get experiment');
      throw error;
    }
  }

  async update(tenantId: string, id: string, patch: UpdateExperimentInput): Promise<unknown> {
    try {
      const existing = await this.db.experiment.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Experiment not found');
      if (patch.datasetId) await this.requireDataset(tenantId, patch.datasetId);
      logger.info({ tenantId, id }, 'Updating experiment');
      return await this.db.experiment.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update experiment');
      throw error;
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      const existing = await this.db.experiment.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Experiment not found');
      await this.db.experiment.delete({ where: { id } });
      logger.info({ tenantId, id }, 'Deleted experiment');
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to delete experiment');
      throw error;
    }
  }
}
