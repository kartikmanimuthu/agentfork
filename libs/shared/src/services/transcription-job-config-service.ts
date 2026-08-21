import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('transcription-job-config-service');

export interface CreateTranscriptionJobConfigInput {
  name: string;
  description?: string | null;
  modelId?: string | null;
  versionId?: string | null;
  config?: Record<string, unknown>;
}

export interface UpdateTranscriptionJobConfigInput {
  name?: string;
  description?: string | null;
  modelId?: string | null;
  versionId?: string | null;
  config?: Record<string, unknown>;
  status?: string;
}

export class TranscriptionJobConfigService {
  private readonly prisma: PrismaClient;

  constructor(
    private readonly tenantId: string,
    prisma: PrismaClient = getPrismaClient()
  ) {
    this.prisma = prisma;
  }

  private async assertReferencesBelongToTenant(modelId?: string | null, versionId?: string | null): Promise<void> {
    if (modelId) {
      const model = await this.prisma.transcriptionModel.findFirst({
        where: { id: modelId, tenantId: this.tenantId },
        select: { id: true },
      });
      if (!model) throw new Error('Transcription model not found');
    }
    if (versionId) {
      const version = await this.prisma.transcriptionModelVersion.findFirst({
        where: { id: versionId, ...(modelId ? { modelId } : {}) },
        select: { model: { select: { tenantId: true } } },
      });
      if (!version || version.model.tenantId !== this.tenantId) {
        throw new Error('Transcription model version not found');
      }
    }
  }

  async create(input: CreateTranscriptionJobConfigInput) {
    try {
      logger.info({ tenantId: this.tenantId, name: input.name }, 'Creating transcription job config');
      await this.assertReferencesBelongToTenant(input.modelId, input.versionId);
      const result = await this.prisma.transcriptionJobConfig.create({
        data: {
          tenantId: this.tenantId,
          name: input.name,
          description: input.description ?? null,
          modelId: input.modelId ?? null,
          versionId: input.versionId ?? null,
          config: (input.config ?? {}) as never,
          status: 'draft',
        },
      });
      logger.info({ tenantId: this.tenantId, jobConfigId: result.id }, 'Transcription job config created');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, name: input.name }, 'Failed to create transcription job config');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ tenantId: this.tenantId, jobConfigId: id }, 'Finding transcription job config by id');
      const result = await this.prisma.transcriptionJobConfig.findFirst({
        where: { id, tenantId: this.tenantId },
        include: {
          model: { select: { id: true, name: true, providerType: true, modelId: true } },
          version: { select: { id: true, version: true, status: true } },
        },
      });
      logger.debug({ tenantId: this.tenantId, jobConfigId: id, found: !!result }, 'Transcription job config findById complete');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, jobConfigId: id, error }, 'Failed to find transcription job config');
      throw error;
    }
  }

  async findMany(filters: { search?: string; status?: string; page?: number; pageSize?: number } = {}) {
    try {
      const { search, status, page = 1, pageSize = 20 } = filters;
      logger.debug({ tenantId: this.tenantId, search, status, page, pageSize }, 'Listing transcription job configs');
      const where: Record<string, unknown> = { tenantId: this.tenantId };
      if (status) where.status = status;
      if (search) {
        where['OR'] = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const skip = (page - 1) * pageSize;
      const [items, total] = await Promise.all([
        this.prisma.transcriptionJobConfig.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { updatedAt: 'desc' },
          include: {
            model: { select: { id: true, name: true, providerType: true, modelId: true } },
            version: { select: { id: true, version: true, status: true } },
            _count: { select: { apiKeys: true, inferences: true } },
          },
        }),
        this.prisma.transcriptionJobConfig.count({ where }),
      ]);

      logger.info({ tenantId: this.tenantId, total, page, pageSize }, 'Transcription job config list complete');
      return { items, total, page, pageSize };
    } catch (error) {
      logger.error({ tenantId: this.tenantId, error, filters }, 'Failed to list transcription job configs');
      throw error;
    }
  }

  async update(id: string, input: UpdateTranscriptionJobConfigInput) {
    try {
      logger.info({ tenantId: this.tenantId, jobConfigId: id, fields: Object.keys(input) }, 'Updating transcription job config');
      await this.assertReferencesBelongToTenant(input.modelId, input.versionId);
      const result = await this.prisma.transcriptionJobConfig.update({
        where: { id, tenantId: this.tenantId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.modelId !== undefined && { modelId: input.modelId }),
          ...(input.versionId !== undefined && { versionId: input.versionId }),
          ...(input.config !== undefined && { config: input.config as never }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      logger.info({ tenantId: this.tenantId, jobConfigId: id }, 'Transcription job config updated');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, jobConfigId: id, error }, 'Failed to update transcription job config');
      throw error;
    }
  }

  async delete(id: string) {
    try {
      logger.info({ tenantId: this.tenantId, jobConfigId: id }, 'Deleting transcription job config');
      const result = await this.prisma.transcriptionJobConfig.delete({
        where: { id, tenantId: this.tenantId },
      });
      logger.info({ tenantId: this.tenantId, jobConfigId: id }, 'Transcription job config deleted');
      return result;
    } catch (error) {
      logger.error({ tenantId: this.tenantId, jobConfigId: id, error }, 'Failed to delete transcription job config');
      throw error;
    }
  }

  async resolveConfig(id: string) {
    const config = await this.findById(id);
    if (!config) throw new Error('Transcription job config not found');
    return config;
  }
}
