import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('transcription-model-version-service');

export interface TranscriptionModelVersionResponse {
  id: string;
  modelId: string;
  version: number;
  status: string;
  config: unknown;
  changeNotes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Immutable numbered config snapshots for a transcription model (mirrors
 * AgentVersionService). The parent model's activeVersionId points at the version
 * used to run jobs; each job records the providerVersionId it ran under.
 */
export class TranscriptionModelVersionService {
  private readonly prisma: PrismaClient;

  constructor(
    private readonly tenantId: string,
    prisma: PrismaClient = getPrismaClient()
  ) {
    this.prisma = prisma;
  }

  private async assertOwnership(modelId: string): Promise<void> {
    const model = await this.prisma.transcriptionModel.findFirst({
      where: { id: modelId, tenantId: this.tenantId },
      select: { id: true },
    });
    if (!model) throw new Error('Transcription model not found');
  }

  /** Snapshot the model's current config as the next version (starts as draft). */
  async create(modelId: string, changeNotes?: string, createdBy = 'system'): Promise<TranscriptionModelVersionResponse> {
    await this.assertOwnership(modelId);
    const model = await this.prisma.transcriptionModel.findUniqueOrThrow({ where: { id: modelId } });
    const config = {
      providerType: model.providerType,
      contract: model.contract,
      endpointUrl: model.endpointUrl,
      region: model.region,
      modelId: model.modelId,
      config: model.config,
    };
    const count = await this.prisma.transcriptionModelVersion.count({ where: { modelId } });
    const row = await this.prisma.transcriptionModelVersion.create({
      data: {
        modelId,
        version: count + 1,
        status: 'draft',
        config: config as never,
        changeNotes: changeNotes ?? null,
        createdBy,
      },
    });
    logger.info({ tenantId: this.tenantId, modelId, version: row.version }, 'Created transcription model version');
    return this.toResponse(row);
  }

  async list(modelId: string): Promise<TranscriptionModelVersionResponse[]> {
    await this.assertOwnership(modelId);
    const rows = await this.prisma.transcriptionModelVersion.findMany({
      where: { modelId },
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  /** Publish a version and point the model's activeVersionId at it. */
  async publish(modelId: string, versionId: string): Promise<TranscriptionModelVersionResponse | null> {
    await this.assertOwnership(modelId);
    const version = await this.prisma.transcriptionModelVersion.findFirst({ where: { id: versionId, modelId } });
    if (!version) return null;
    const row = await this.prisma.transcriptionModelVersion.update({
      where: { id: versionId },
      data: { status: 'published' },
    });
    await this.prisma.transcriptionModel.update({ where: { id: modelId }, data: { activeVersionId: versionId } });
    logger.info({ tenantId: this.tenantId, modelId, versionId }, 'Published transcription model version');
    return this.toResponse(row);
  }

  private toResponse(row: {
    id: string;
    modelId: string;
    version: number;
    status: string;
    config: unknown;
    changeNotes: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }): TranscriptionModelVersionResponse {
    return {
      id: row.id,
      modelId: row.modelId,
      version: row.version,
      status: row.status,
      config: row.config,
      changeNotes: row.changeNotes,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
