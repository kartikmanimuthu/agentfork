import {
  getPrismaClient,
  TranscriptionJobService,
  resolveTenantFolder,
  withTimeout,
  env,
} from '@chatbot/shared';
import { S3Service, executeTranscription } from '@chatbot/shared/server';
import { transcribeAudio } from '@chatbot/ai';
import { transcriptionJobSchema } from './schema.js';
import { createBoss } from '../../boss.js';
import { createLogger } from '../../lib/logger.js';

async function enqueueWebhookRetry(jobId: string, tenantId: string): Promise<void> {
  const boss = createBoss();
  try {
    await boss.start();
    await boss.send('transcription-webhook-retry', { jobId, tenantId });
  } finally {
    await boss.stop({ graceful: false }).catch(() => {});
  }
}

const log = createLogger('transcription-handler');

export async function handleTranscription(raw: unknown): Promise<void> {
  const data = transcriptionJobSchema.parse(raw);
  const db = getPrismaClient();
  const jobService = new TranscriptionJobService(db);

  log.info('Processing transcription job', { jobId: data.jobId, source: data.source });

  let audio: Buffer;
  let tenantFolder: string;
  const mimeType = data.mimeType;
  try {
    // markRunning moved inside this try (was previously called before any error handling
    // existed) — a stalled DB connection here used to hang with no isFinalAttempt-gated
    // failure/webhook path at all, the same gap the S3 download and tenant-folder lookup
    // below already had before this fix.
    await withTimeout(jobService.markRunning(data.jobId), 30_000, `Marking job running timed out for job ${data.jobId}`);
    if (!data.stashKey) throw new Error('async job missing stashKey');
    audio = await new S3Service().downloadAsBuffer(data.stashKey);
    // Bounded well below pg-boss's own retry delay — this is a single-row lookup, never
    // expected to take more than a moment. Without a ceiling here, a stalled DB connection
    // would hang this call forever, same failure shape as the unbounded S3 call above.
    tenantFolder = await withTimeout(
      resolveTenantFolder(data.tenantId, db),
      30_000,
      `Resolving tenant folder timed out for tenant ${data.tenantId}`
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const isFinalAttempt = data.isFinalAttempt ?? true;
    log.error('Failed to prepare transcription job (marking running, audio fetch, or tenant lookup)', { jobId: data.jobId, errorMessage: error.message, isFinalAttempt });
    // Same rule as executeTranscription: only finalize + notify once no retries remain,
    // so a transient blip that succeeds on retry doesn't already report failure.
    if (isFinalAttempt) {
      await jobService.fail(data.jobId, error.message);
      if (data.webhookUrl) {
        await enqueueWebhookRetry(data.jobId, data.tenantId).catch((e) =>
          log.warn('Failed to enqueue webhook retry after job preparation failure', { jobId: data.jobId, err: e instanceof Error ? e.message : e })
        );
      }
    }
    throw error;
  }

  await executeTranscription(db, transcribeAudio, {
    jobId: data.jobId,
    tenantId: data.tenantId,
    tenantFolder,
    apiKeyId: data.apiKeyId,
    jobConfigId: data.jobConfigId ?? undefined,
    modelId: data.modelId ?? undefined,
    versionId: data.versionId ?? undefined,
    audio,
    mimeType,
    fileName: data.fileName ?? undefined,
    s3Key: data.s3Key ?? undefined,
    uploadId: data.uploadId ?? undefined,
    clientReference: data.clientReference ?? undefined,
    language: data.language ?? undefined,
    diarize: data.diarize ?? undefined,
    engineTimeoutMs: env.TRANSCRIPTION_ENGINE_ASYNC_TIMEOUT_MS,
    isFinalAttempt: data.isFinalAttempt,
    totalAttempts: data.totalAttempts,
    webhookUrl: data.webhookUrl ?? undefined,
    webhookSecret: data.webhookSecret ?? undefined,
    onWebhookFailure: (id) => enqueueWebhookRetry(id, data.tenantId),
  });

  log.info('Transcription job completed', { jobId: data.jobId });
}
