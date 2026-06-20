import { createLogger } from '../logging/logger';
import type { ScoreDataType } from './score-config-service';

const logger = createLogger('evaluator-service');

export interface CreateEvaluatorInput {
  tenantId: string;
  name: string;
  description?: string;
  scoreConfigId: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  createdBy: string;
}

export interface UpdateEvaluatorInput {
  name?: string;
  description?: string;
  scoreConfigId?: string;
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  isActive?: boolean;
}

export interface EvaluatorDb {
  evaluator: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }): Promise<unknown[]>;
    findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string; dataType: ScoreDataType } | null> };
}

export class EvaluatorService {
  constructor(private readonly db: EvaluatorDb) {}

  private async requireScoreConfigInTenant(tenantId: string, scoreConfigId: string): Promise<void> {
    const config = await this.db.scoreConfig.findFirst({ where: { id: scoreConfigId, tenantId } });
    if (!config) throw new Error('Score config not found');
  }

  private async requireOwned(tenantId: string, id: string): Promise<void> {
    const existing = await this.db.evaluator.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Evaluator not found');
  }

  async create(input: CreateEvaluatorInput): Promise<unknown> {
    try {
      await this.requireScoreConfigInTenant(input.tenantId, input.scoreConfigId);
      logger.info({ tenantId: input.tenantId, name: input.name }, 'Creating evaluator');
      return await this.db.evaluator.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          description: input.description ?? null,
          scoreConfigId: input.scoreConfigId,
          prompt: input.prompt,
          model: input.model ?? null,
          temperature: input.temperature ?? null,
          maxTokens: input.maxTokens ?? null,
          createdBy: input.createdBy,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, name: input.name }, 'Failed to create evaluator');
      throw error;
    }
  }

  async list(tenantId: string): Promise<unknown[]> {
    try {
      return await this.db.evaluator.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list evaluators');
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<unknown | null> {
    try {
      return await this.db.evaluator.findFirst({
        where: { id, tenantId },
        include: { scoreConfig: { select: { id: true, name: true, dataType: true, categories: true } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to get evaluator');
      throw error;
    }
  }

  async update(tenantId: string, id: string, patch: UpdateEvaluatorInput): Promise<unknown> {
    try {
      await this.requireOwned(tenantId, id);
      if (patch.scoreConfigId) await this.requireScoreConfigInTenant(tenantId, patch.scoreConfigId);
      logger.info({ tenantId, id }, 'Updating evaluator');
      return await this.db.evaluator.update({ where: { id }, data: { ...patch } });
    } catch (error) {
      logger.error({ err: error, tenantId, id }, 'Failed to update evaluator');
      throw error;
    }
  }

  async disable(tenantId: string, id: string): Promise<unknown> {
    return this.update(tenantId, id, { isActive: false });
  }
}
