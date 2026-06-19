import { createLogger } from '../logging/logger';

const logger = createLogger('score-config-service');

export type ScoreDataType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
export interface ScoreCategory { label: string; value: number; }

export interface CreateScoreConfigInput {
  tenantId: string;
  name: string;
  description?: string;
  dataType: ScoreDataType;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreCategory[];
  createdBy: string;
}

export interface UpdateScoreConfigInput {
  name?: string;
  description?: string;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreCategory[];
  isArchived?: boolean;
}

export interface ScoreConfigDb {
  scoreConfig: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

function assertValidConfig(input: { dataType: ScoreDataType; minValue?: number; maxValue?: number; categories?: ScoreCategory[] }): void {
  if (input.dataType === 'NUMERIC' && input.minValue != null && input.maxValue != null && input.minValue >= input.maxValue) {
    throw new Error('minValue must be less than maxValue');
  }
  if (input.dataType === 'CATEGORICAL' && (!input.categories || input.categories.length === 0)) {
    throw new Error('CATEGORICAL config requires at least one category');
  }
}

export class ScoreConfigService {
  constructor(private readonly db: ScoreConfigDb) {}

  async create(input: CreateScoreConfigInput): Promise<unknown> {
    try {
      assertValidConfig(input);
      logger.info({ tenantId: input.tenantId, name: input.name, dataType: input.dataType }, 'Creating score config');
      return await this.db.scoreConfig.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          dataType: input.dataType,
          minValue: input.minValue ?? null,
          maxValue: input.maxValue ?? null,
          categories: input.categories ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create score config');
      throw error;
    }
  }

  async list(tenantId: string, opts?: { includeArchived?: boolean }): Promise<unknown[]> {
    try {
      const where: Record<string, unknown> = { tenantId };
      if (!opts?.includeArchived) where.isArchived = false;
      return await this.db.scoreConfig.findMany({ where, orderBy: { createdAt: 'desc' } });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list score configs');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.scoreConfig.findFirst({ where: { id, tenantId } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get score config');
      throw error;
    }
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    try {
      const existing = await this.db.scoreConfig.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Score config not found');
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to find score config');
      throw error;
    }
  }

  async update(tenantId: string, id: string, patch: UpdateScoreConfigInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Updating score config');
      return await this.db.scoreConfig.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update score config');
      throw error;
    }
  }

  async archive(tenantId: string, id: string): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      logger.info({ tenantId, id }, 'Archiving score config');
      return await this.db.scoreConfig.update({ where: { id }, data: { isArchived: true } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to archive score config');
      throw error;
    }
  }
}
