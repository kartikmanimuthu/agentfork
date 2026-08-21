import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('transcription-job-version-service');

export class TranscriptionJobVersionService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async create(jobConfigId: string, config: Record<string, unknown>, changeNotes?: string) {
    try {
      logger.info({ jobConfigId }, 'Creating transcription job version');
      const count = await this.prisma.transcriptionJobVersion.count({ where: { jobConfigId } });
      const result = await this.prisma.transcriptionJobVersion.create({
        data: {
          jobConfigId,
          version: count + 1,
          config: config as never,
          status: 'draft',
          changeNotes: changeNotes ?? null,
        },
      });
      logger.info({ jobConfigId, versionId: result.id, version: count + 1 }, 'Transcription job version created');
      return result;
    } catch (error) {
      logger.error({ jobConfigId, error }, 'Failed to create transcription job version');
      throw error;
    }
  }

  async findById(id: string) {
    try {
      logger.debug({ versionId: id }, 'Finding transcription job version by id');
      const result = await this.prisma.transcriptionJobVersion.findFirst({ where: { id } });
      logger.debug({ versionId: id, found: !!result }, 'Transcription job version findById complete');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to find transcription job version');
      throw error;
    }
  }

  async findByJobConfigId(jobConfigId: string) {
    try {
      logger.debug({ jobConfigId }, 'Listing transcription job versions');
      const result = await this.prisma.transcriptionJobVersion.findMany({
        where: { jobConfigId },
        orderBy: { version: 'desc' },
      });
      logger.info({ jobConfigId, count: result.length }, 'Transcription job version list complete');
      return result;
    } catch (error) {
      logger.error({ jobConfigId, error }, 'Failed to list transcription job versions');
      throw error;
    }
  }

  async publish(id: string) {
    try {
      logger.info({ versionId: id }, 'Publishing transcription job version');
      const result = await this.prisma.transcriptionJobVersion.update({
        where: { id },
        data: { status: 'published' },
      });
      logger.info({ versionId: id }, 'Transcription job version published');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to publish transcription job version');
      throw error;
    }
  }

  async archive(id: string) {
    try {
      logger.info({ versionId: id }, 'Archiving transcription job version');
      const result = await this.prisma.transcriptionJobVersion.update({
        where: { id },
        data: { status: 'archived' },
      });
      logger.info({ versionId: id }, 'Transcription job version archived');
      return result;
    } catch (error) {
      logger.error({ versionId: id, error }, 'Failed to archive transcription job version');
      throw error;
    }
  }
}
