import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('transcription-job-service');

export interface CreateTranscriptionJobInput {
  apiKeyId: string;
  tenantId: string;
  jobConfigId?: string | null;
  modelId?: string | null;
  providerVersionId?: string | null;
  source: 'upload' | 'payload' | 's3';
  /** TranscriptionUpload claimed by this job; null for inline 'payload' jobs. */
  uploadId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  s3Bucket?: string | null;
  s3Key?: string | null;
  inputS3Key?: string | null;
  webhookUrl?: string | null;
  /** 'running' for sync (default), 'queued' for async jobs picked up by a worker. */
  status?: 'running' | 'queued';
}

export interface CompleteTranscriptionJobInput {
  transcript: string;
  language?: string | null;
  durationSec?: number | null;
  output?: unknown;
  outputS3Key?: string | null;
  providerVersionId?: string | null;
  latencyMs: number;
}

/** Lifecycle helpers for TranscriptionJob rows (mirrors ApiKeyExecution usage). */
export class TranscriptionJobService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async create(input: CreateTranscriptionJobInput) {
    const job = await this.prisma.transcriptionJob.create({
      data: {
        apiKeyId: input.apiKeyId,
        tenantId: input.tenantId,
        jobConfigId: input.jobConfigId ?? null,
        modelId: input.modelId ?? null,
        providerVersionId: input.providerVersionId ?? null,
        source: input.source,
        uploadId: input.uploadId ?? null,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        s3Bucket: input.s3Bucket ?? null,
        s3Key: input.s3Key ?? null,
        inputS3Key: input.inputS3Key ?? null,
        webhookUrl: input.webhookUrl ?? null,
        status: input.status ?? 'running',
        startedAt: (input.status ?? 'running') === 'running' ? new Date() : null,
      },
    });
    logger.info({ tenantId: input.tenantId, jobId: job.id, source: input.source, status: job.status }, 'Transcription job created');
    return job;
  }

  /** Mark a queued job as running when a worker picks it up. */
  async markRunning(id: string) {
    return this.prisma.transcriptionJob.update({
      where: { id },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  async complete(id: string, input: CompleteTranscriptionJobInput) {
    return this.prisma.transcriptionJob.update({
      where: { id },
      data: {
        status: 'completed',
        transcript: input.transcript,
        language: input.language ?? null,
        durationSec: input.durationSec ?? null,
        output: (input.output ?? null) as never,
        outputS3Key: input.outputS3Key ?? null,
        ...(input.providerVersionId !== undefined ? { providerVersionId: input.providerVersionId } : {}),
        latencyMs: input.latencyMs,
        completedAt: new Date(),
      },
    });
  }

  async fail(id: string, error: string, latencyMs?: number) {
    return this.prisma.transcriptionJob.update({
      where: { id },
      data: {
        status: 'failed',
        error,
        latencyMs: latencyMs ?? null,
        completedAt: new Date(),
      },
    });
  }

  /**
   * `terminal` marks this as the LAST attempt — the retry queue has exhausted its retry
   * limit and given up, not just "this one attempt failed" (which may still be retried).
   * Distinguishing the two means a caller checking `webhookStatus` can tell "still might
   * retry" apart from "we're done trying, this will never be delivered".
   */
  async setWebhookResult(id: string, delivered: boolean, terminal = false) {
    return this.prisma.transcriptionJob.update({
      where: { id },
      data: {
        webhookStatus: delivered ? 'delivered' : terminal ? 'undeliverable' : 'failed',
        webhookDeliveredAt: delivered ? new Date() : null,
        webhookAttempts: { increment: 1 },
      },
    });
  }

  async findById(id: string, tenantId: string) {
    return this.prisma.transcriptionJob.findFirst({
      where: { id, tenantId },
      // The upload carries the caller-facing identifier and their own reference, both of
      // which the dashboard surfaces so support can correlate against customer requests.
      include: { upload: { select: { id: true, clientReference: true } } },
    });
  }
}
