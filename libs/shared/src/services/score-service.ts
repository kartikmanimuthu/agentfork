import { createLogger } from '../logging/logger';
import type { ScoreCategory, ScoreDataType } from './score-config-service';

const logger = createLogger('score-service');

export type ScoreTargetType = 'MESSAGE' | 'SESSION' | 'EXECUTION';
export type ScoreValue = number | string | boolean;

export interface CreateManualScoreInput {
  tenantId: string;
  configId: string;
  targetType: ScoreTargetType;
  targetId: string;
  value: ScoreValue;
  comment?: string;
  authorUserId: string;
}

export interface IngestScoreInput {
  tenantId: string;
  configId: string;
  targetType: ScoreTargetType;
  targetId: string;
  value: ScoreValue;
  comment?: string;
  source?: 'ANNOTATION' | 'API' | 'EVALUATOR';
}

export interface ScoreFilters {
  configId?: string;
  targetType?: ScoreTargetType;
  sessionId?: string;
  messageId?: string;
  executionId?: string;
  source?: 'ANNOTATION' | 'API' | 'EVALUATOR';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

interface ScoreConfigRow {
  id: string;
  tenantId: string;
  dataType: ScoreDataType;
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreCategory[] | null;
  isArchived: boolean;
}

export interface ScoreDb {
  scoreConfig: { findFirst(args: { where: Record<string, unknown> }): Promise<ScoreConfigRow | null> };
  score: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown; take?: number; skip?: number; include?: unknown }): Promise<unknown[]>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  inferenceSessionMessage: { findFirst(args: { where: Record<string, unknown>; include?: unknown }): Promise<{ id: string; session: { tenantId: string } } | null> };
  inferenceSession: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
  apiKeyExecution: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; tenantId: string } | null> };
}

interface ResolvedValue { numericValue: number | null; stringValue: string | null; }

function resolveValue(config: ScoreConfigRow, value: ScoreValue): ResolvedValue {
  switch (config.dataType) {
    case 'NUMERIC': {
      if (typeof value !== 'number') throw new Error('NUMERIC score requires a numeric value');
      if ((config.minValue != null && value < config.minValue) || (config.maxValue != null && value > config.maxValue)) {
        throw new Error(`Score value out of range [${config.minValue}, ${config.maxValue}]`);
      }
      return { numericValue: value, stringValue: null };
    }
    case 'BOOLEAN': {
      const bool = typeof value === 'boolean' ? value : value === 'true' || value === 1;
      return { numericValue: bool ? 1 : 0, stringValue: bool ? 'true' : 'false' };
    }
    case 'CATEGORICAL': {
      const label = String(value);
      const match = (config.categories ?? []).find((c) => c.label === label);
      if (!match) throw new Error(`Categorical value "${label}" is not a defined category`);
      return { numericValue: match.value, stringValue: label };
    }
    default:
      throw new Error(`Unsupported dataType: ${config.dataType}`);
  }
}

export class ScoreService {
  constructor(private readonly db: ScoreDb) {}

  private async loadConfig(tenantId: string, configId: string): Promise<ScoreConfigRow> {
    const config = await this.db.scoreConfig.findFirst({ where: { id: configId, tenantId } });
    if (!config) throw new Error('Score config not found');
    return config;
  }

  private async assertTargetInTenant(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<void> {
    if (targetType === 'MESSAGE') {
      const msg = await this.db.inferenceSessionMessage.findFirst({ where: { id: targetId }, include: { session: { select: { tenantId: true } } } });
      if (!msg || msg.session.tenantId !== tenantId) throw new Error('Score target message not found in tenant');
    } else if (targetType === 'SESSION') {
      const session = await this.db.inferenceSession.findFirst({ where: { id: targetId, tenantId } });
      if (!session) throw new Error('Score target session not found in tenant');
    } else {
      // EXECUTION
      const execution = await this.db.apiKeyExecution.findFirst({ where: { id: targetId, tenantId } });
      if (!execution) throw new Error('Score target execution not found in tenant');
    }
  }

  private targetColumns(targetType: ScoreTargetType, targetId: string): { messageId: string | null; sessionId: string | null; executionId: string | null } {
    if (targetType === 'MESSAGE')  return { messageId: targetId, sessionId: null,    executionId: null };
    if (targetType === 'SESSION')  return { messageId: null,    sessionId: targetId, executionId: null };
    /* EXECUTION */                return { messageId: null,    sessionId: null,      executionId: targetId };
  }

  async createManual(input: CreateManualScoreInput): Promise<unknown> {
    try {
      const config = await this.loadConfig(input.tenantId, input.configId);
      await this.assertTargetInTenant(input.tenantId, input.targetType, input.targetId);
      const resolved = resolveValue(config, input.value);
      const cols = this.targetColumns(input.targetType, input.targetId);

      const existing = await this.db.score.findFirst({
        where: { tenantId: input.tenantId, configId: input.configId, authorUserId: input.authorUserId, ...cols },
      });

      const data = {
        ...resolved,
        comment: input.comment ?? null,
        source: 'ANNOTATION',
      };

      if (existing) {
        logger.info({ tenantId: input.tenantId, scoreId: existing.id, configId: input.configId }, 'Updating manual score');
        return await this.db.score.update({ where: { id: existing.id }, data });
      }
      logger.info({ tenantId: input.tenantId, configId: input.configId, targetType: input.targetType }, 'Creating manual score');
      return await this.db.score.create({
        data: { tenantId: input.tenantId, configId: input.configId, targetType: input.targetType, ...cols, ...data, authorUserId: input.authorUserId },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, configId: input.configId }, 'Failed to create manual score');
      throw error;
    }
  }

  async ingest(input: IngestScoreInput): Promise<unknown> {
    try {
      const config = await this.loadConfig(input.tenantId, input.configId);
      await this.assertTargetInTenant(input.tenantId, input.targetType, input.targetId);
      const resolved = resolveValue(config, input.value);
      const cols = this.targetColumns(input.targetType, input.targetId);
      logger.info({ tenantId: input.tenantId, configId: input.configId, targetType: input.targetType }, 'Ingesting API score');
      return await this.db.score.create({
        data: {
          tenantId: input.tenantId,
          configId: input.configId,
          targetType: input.targetType,
          ...cols,
          ...resolved,
          comment: input.comment ?? null,
          source: input.source ?? 'API',
          authorUserId: null,
        },
      });
    } catch (error) {
      logger.error({ err: error, tenantId: input.tenantId, configId: input.configId }, 'Failed to ingest score');
      throw error;
    }
  }

  async listByTarget(tenantId: string, targetType: ScoreTargetType, targetId: string): Promise<unknown[]> {
    const cols = this.targetColumns(targetType, targetId);
    return this.db.score.findMany({ where: { tenantId, ...cols }, orderBy: { createdAt: 'desc' }, include: { config: true } });
  }

  async listByTenant(tenantId: string, filters: ScoreFilters): Promise<unknown[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.configId) where.configId = filters.configId;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.sessionId) where.sessionId = filters.sessionId;
    if (filters.messageId) where.messageId = filters.messageId;
    if (filters.executionId) where.executionId = filters.executionId;
    if (filters.source) where.source = filters.source;
    if (filters.fromDate || filters.toDate) {
      const range: Record<string, Date> = {};
      if (filters.fromDate) range.gte = new Date(filters.fromDate);
      if (filters.toDate) range.lte = new Date(`${filters.toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }
    return this.db.score.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
      include: { config: true },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    try {
      const existing = await this.db.score.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error('Score not found');
      await this.db.score.delete({ where: { id } });
      logger.info({ tenantId, scoreId: id }, 'Deleted score');
    } catch (error) {
      logger.error({ err: error, tenantId, scoreId: id }, 'Failed to delete score');
      throw error;
    }
  }
}
