import type { PrismaClient } from '@prisma/client';
import { TranscriptionJobService } from './transcription-job-service';
import { S3Service } from './s3-service';
import { executeTranscription, type TranscribeFn } from './transcription-runner';
import { env } from '../env';

export class PayloadTooLargeError extends Error {}

/**
 * Enqueues a background job. Injected by callers (same pattern as TranscribeFn) so
 * libs/shared stays decoupled from pg-boss — and so the caller owns the queue's lifecycle.
 * Web-ui passes a function backed by its process-wide shared instance; the worker passes
 * its own. Implementations must NOT start/stop a queue per call.
 */
export type EnqueueFn = (name: string, data: Record<string, unknown>) => Promise<void>;

export interface ResolvedJobConfigRef {
  modelId: string | null;
  versionId: string | null;
  config: unknown;
}

export interface DispatchUploadedTranscriptionParams {
  db: PrismaClient;
  transcribe: TranscribeFn;
  enqueue: EnqueueFn;
  tenantId: string;
  tenantFolder: string;
  apiKeyId: string;
  jobConfigId?: string | null;
  resolvedJobConfig: ResolvedJobConfigRef | null;
  keyModelId?: string | null;
  keyWebhookUrl?: string | null;
  webhookSecret?: string | null;
  s3Key: string;
  mimeType: string;
  fileName?: string;
  /** The TranscriptionUpload this job claims; carried into the webhook for correlation. */
  uploadId?: string | null;
  /** The caller's own reference, echoed back in the webhook and transcript retrieval. */
  clientReference?: string | null;
  language?: string;
  diarize?: boolean;
  webhookUrl?: string | null;
  modelId?: string | null;
  versionId?: string | null;
  sync: boolean;
  maxBytes: number;
}

export type DispatchUploadedTranscriptionResult =
  | { sync: false; id: string; status: 'queued'; statusUrl: string }
  | {
      sync: true;
      id: string;
      systemAnnouncement: boolean;
      text: string;
      language: string | null;
      languageDetected: boolean;
      languageDetectionConfidence: number | null;
      durationSec: number | null;
      segments: unknown[] | null;
      outputS3Key: string | null;
      audioMinutes: number;
    };

async function enqueueWebhookRetry(enqueue: EnqueueFn, jobId: string, tenantId: string): Promise<void> {
  await enqueue('transcription-webhook-retry', { jobId, tenantId });
}

/**
 * Runs transcription for audio that's already sitting in S3 under a staging key
 * (i.e. `source: 'upload'`) — shared by the Transcription API's upload-ref path and the
 * Upload API's `autoTranscribe` shortcut, so both go through one implementation of
 * quota-agnostic job creation, staging-key promotion, and sync/async dispatch.
 */
export async function dispatchUploadedTranscription(
  p: DispatchUploadedTranscriptionParams & { sync: false }
): Promise<Extract<DispatchUploadedTranscriptionResult, { sync: false }>>;
export async function dispatchUploadedTranscription(
  p: DispatchUploadedTranscriptionParams & { sync: true }
): Promise<Extract<DispatchUploadedTranscriptionResult, { sync: true }>>;
export async function dispatchUploadedTranscription(
  p: DispatchUploadedTranscriptionParams
): Promise<DispatchUploadedTranscriptionResult> {
  const effectiveModelId = p.modelId ?? p.resolvedJobConfig?.modelId ?? p.keyModelId ?? undefined;
  const providerVersionId = p.versionId ?? p.resolvedJobConfig?.versionId ?? undefined;
  const jobConfigOverrides = (p.resolvedJobConfig?.config ?? {}) as Record<string, unknown>;
  const effectiveLanguage = p.language ?? (jobConfigOverrides.language as string | undefined) ?? undefined;
  const effectiveDiarize = p.diarize ?? (jobConfigOverrides.diarize as boolean | undefined);
  const webhookUrl = p.webhookUrl ?? p.keyWebhookUrl ?? null;
  const jobService = new TranscriptionJobService(p.db);

  if (!p.sync) {
    const job = await jobService.create({
      apiKeyId: p.apiKeyId,
      tenantId: p.tenantId,
      jobConfigId: p.jobConfigId ?? undefined,
      modelId: effectiveModelId,
      providerVersionId,
      source: 'upload',
      uploadId: p.uploadId,
      fileName: p.fileName,
      mimeType: p.mimeType,
      webhookUrl,
      status: 'queued',
    });

    const s3 = new S3Service();
    const inputFileName = p.fileName || 'audio';
    const stashKey = `transcription/${p.tenantFolder}/${job.id}/input/${inputFileName}`;
    await s3.moveObject(p.s3Key, stashKey);
    await p.db.transcriptionJob.update({ where: { id: job.id }, data: { s3Key: stashKey, inputS3Key: stashKey } });

    await p.enqueue('transcription', {
      jobId: job.id,
      tenantId: p.tenantId,
      apiKeyId: p.apiKeyId,
      jobConfigId: p.jobConfigId ?? null,
      modelId: effectiveModelId ?? null,
      versionId: providerVersionId ?? null,
      source: 'upload',
      stashKey,
      s3Key: p.s3Key,
      uploadId: p.uploadId ?? null,
      clientReference: p.clientReference ?? null,
      mimeType: p.mimeType,
      fileName: p.fileName ?? null,
      language: effectiveLanguage ?? null,
      diarize: effectiveDiarize ?? null,
      webhookUrl,
      webhookSecret: p.webhookSecret,
    });

    return { sync: false, id: job.id, status: 'queued', statusUrl: `/api/v1/transcription/jobs/${job.id}` };
  }

  const audio = await new S3Service().downloadAsBuffer(p.s3Key);
  if (audio.length > p.maxBytes) {
    throw new PayloadTooLargeError('Audio exceeds max size');
  }

  const job = await jobService.create({
    apiKeyId: p.apiKeyId,
    tenantId: p.tenantId,
    jobConfigId: p.jobConfigId ?? undefined,
    modelId: effectiveModelId,
    providerVersionId,
    source: 'upload',
    uploadId: p.uploadId,
    fileName: p.fileName,
    mimeType: p.mimeType,
    sizeBytes: audio.length,
    webhookUrl,
  });

  const inputFileName = p.fileName || 'audio';
  const newKey = `transcription/${p.tenantFolder}/${job.id}/input/${inputFileName}`;
  await new S3Service().moveObject(p.s3Key, newKey);
  await p.db.transcriptionJob.update({ where: { id: job.id }, data: { s3Key: newKey, inputS3Key: newKey } });

  const result = await executeTranscription(p.db, p.transcribe, {
    jobId: job.id,
    tenantId: p.tenantId,
    tenantFolder: p.tenantFolder,
    apiKeyId: p.apiKeyId,
    jobConfigId: p.jobConfigId ?? undefined,
    modelId: effectiveModelId,
    versionId: providerVersionId,
    audio,
    mimeType: p.mimeType,
    fileName: p.fileName,
    s3Key: p.s3Key,
    uploadId: p.uploadId,
    clientReference: p.clientReference,
    language: effectiveLanguage,
    diarize: effectiveDiarize,
    engineTimeoutMs: env.TRANSCRIPTION_ENGINE_TIMEOUT_MS,
    webhookUrl,
    webhookSecret: p.webhookSecret,
    onWebhookFailure: (id) => enqueueWebhookRetry(p.enqueue, id, p.tenantId),
  });

  const audioMinutes = result.durationSec ? result.durationSec / 60 : 0;
  return {
    sync: true,
    id: job.id,
    systemAnnouncement: result.systemAnnouncement ?? false,
    text: result.text,
    language: result.language,
    languageDetected: result.languageDetected,
    languageDetectionConfidence: result.languageDetectionConfidence,
    durationSec: result.durationSec,
    segments: result.segments,
    outputS3Key: result.outputS3Key,
    audioMinutes,
  };
}
