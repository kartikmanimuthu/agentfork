import type { PrismaClient } from '@prisma/client';
import { TranscriptionModelService } from './transcription-model-service';
import { TranscriptionApiKeyService } from './transcription-api-key-service';
import { TranscriptionJobService } from './transcription-job-service';
import { WebhookService } from './webhook-service';
import { S3Service } from './s3-service';
import { createLogger } from '../logging/logger';
import { withTimeout } from '../utils/with-timeout';

const logger = createLogger('transcription-runner');

/** Minimal result shape the injected transcribe fn must return. */
export interface TranscribeResult {
  text: string;
  language?: string;
  durationSec?: number;
  segments?: unknown[];
  /** True when the engine auto-detected the language (caller omitted it / sent "auto"). */
  languageDetected?: boolean;
  /** Confidence (0-1) of the detected language, when languageDetected is true. */
  languageDetectionConfidence?: number;
  /** True when the engine recognized this audio as a known non-conversational system
   *  announcement instead of real speech. See libs/ai/src/transcription.ts for the
   *  full contract. */
  outcome?: 'system_announcement' | 'transcribed';
  /** Which known language variant of the system announcement matched. */
  matchedVariant?: string;
  /** Confidence (0-1) of the system-announcement match. */
  matchConfidence?: number;
}

/** The engine call, injected so libs/shared stays decoupled from libs/ai. */
export type TranscribeFn = (input: {
  endpointUrl?: string | null;
  contract?: 'custom' | 'openai-audio';
  model?: string | null;
  credentials?: Record<string, string> | null;
  audio: Buffer;
  mimeType: string;
  fileName?: string;
  language?: string;
  diarize?: boolean;
  maxSpeakers?: number;
  timeoutMs?: number;
}) => Promise<TranscribeResult>;

export interface ExecuteTranscriptionParams {
  jobId: string;
  tenantId: string;
  tenantFolder: string;
  apiKeyId: string;
  jobConfigId?: string | null;
  modelId?: string | null;
  versionId?: string | null;
  audio: Buffer;
  mimeType: string;
  fileName?: string;
  /** The s3Key the Upload API returned to the caller, when this job's audio came from an upload. */
  s3Key?: string | null;
  /** The TranscriptionUpload id — the caller's stable identifier, echoed into the webhook. */
  uploadId?: string | null;
  /** The caller's own reference, echoed into the webhook so they need no mapping table. */
  clientReference?: string | null;
  language?: string;
  diarize?: boolean;
  /** Milliseconds before the engine call is aborted. Caller decides based on sync vs async. */
  engineTimeoutMs?: number;
  /**
   * Whether this is the last allowed attempt for this job (no further retries left).
   * Sync callers have no retry concept and always pass true (or omit — defaults to true).
   * The async worker passes false for every attempt except the last, so a job that will
   * still be retried doesn't prematurely mark itself failed or notify the caller before
   * pg-boss has actually given up.
   */
  isFinalAttempt?: boolean;
  /** Total attempts allowed for this job (retryLimit + 1) — used only to word the
   *  customer-facing error message on the final attempt (e.g. "after 6 attempts"). */
  totalAttempts?: number;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  /**
   * Called when the FIRST webhook delivery attempt fails after a successful
   * transcription. Callers enqueue a pg-boss `transcription-webhook-retry` job here
   * (web-ui route and the async worker each wire their own boss access) so the
   * callback gets retried independently, without re-running the transcription itself.
   * Optional — if omitted, a failed webhook is just recorded, matching prior behavior.
   */
  onWebhookFailure?: (jobId: string) => Promise<void>;
}

export interface ExecuteTranscriptionResult {
  text: string;
  language: string | null;
  durationSec: number | null;
  segments: unknown[] | null;
  outputS3Key: string | null;
  languageDetected: boolean;
  languageDetectionConfidence: number | null;
  /** True only when this result is the known-announcement outcome, not a real transcript. */
  systemAnnouncement?: true;
}

async function deliverCompletionWebhook(
  p: ExecuteTranscriptionParams,
  jobService: TranscriptionJobService,
  output: Record<string, unknown>,
  latencyMs: number
): Promise<void> {
  if (!p.webhookUrl) return;
  const delivery = await new WebhookService().deliverWithToken(p.webhookUrl, p.webhookSecret ?? null, {
    executionId: p.jobId,
    agentId: '',
    ...(p.uploadId ? { uploadId: p.uploadId } : {}),
    ...(p.clientReference ? { clientReference: p.clientReference } : {}),
    status: 'completed',
    input: { fileName: p.fileName, mimeType: p.mimeType, s3Key: p.s3Key ?? null },
    output,
    cacheHit: false,
    latencyMs,
    timestamp: new Date().toISOString(),
  });
  await jobService.setWebhookResult(p.jobId, delivery.success);
  if (!delivery.success && p.onWebhookFailure) {
    await p.onWebhookFailure(p.jobId).catch((e) =>
      logger.warn({ tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e }, 'Failed to enqueue webhook retry')
    );
  }
}

/**
 * Core transcription execution shared by the sync API route and the async worker:
 * resolve the tenant's model → transcribe → persist the job → record usage →
 * deliver the optional webhook. On failure it marks the job failed, fires a
 * failure webhook, and rethrows. The TranscriptionJob row must already exist.
 */
export async function executeTranscription(
  db: PrismaClient,
  transcribe: TranscribeFn,
  p: ExecuteTranscriptionParams
): Promise<ExecuteTranscriptionResult> {
  const startedAt = Date.now();
  const jobService = new TranscriptionJobService(db);

  try {
    // Bounded well below the engine call's own (deliberately generous, up to 3h) timeout —
    // this is a DB lookup plus credential decryption, never expected to take more than a
    // moment. Without a ceiling, a stalled DB connection would hang here forever, occupying
    // the batchSize:1 queue slot exactly like the unprotected S3 download used to.
    const modelConfig = await withTimeout(
      new TranscriptionModelService(p.tenantId, db).getConfig(p.modelId, p.versionId),
      30_000,
      `Resolving model config timed out for tenant ${p.tenantId}`
    );

    const result = await transcribe({
      endpointUrl: modelConfig?.endpointUrl,
      contract: (modelConfig?.contract as 'custom' | 'openai-audio' | undefined) ?? 'custom',
      model: modelConfig?.modelId ?? null,
      credentials: modelConfig?.credentials,
      audio: p.audio,
      mimeType: p.mimeType,
      fileName: p.fileName,
      language: p.language,
      diarize: p.diarize,
      maxSpeakers: p.diarize ? 2 : undefined,
      timeoutMs: p.engineTimeoutMs,
    });

    if (result.outcome === 'system_announcement') {
      const latencyMs = Date.now() - startedAt;
      logger.info(
        { tenantId: p.tenantId, jobId: p.jobId, matchedVariant: result.matchedVariant, matchConfidence: result.matchConfidence },
        'System announcement matched — completing without transcription'
      );
      const output = {
        systemAnnouncement: true as const,
        matchedVariant: result.matchedVariant,
        matchConfidence: result.matchConfidence,
      };

      await jobService.complete(p.jobId, {
        transcript: result.text,
        language: result.matchedVariant ?? null,
        durationSec: null,
        output,
        outputS3Key: null,
        providerVersionId: modelConfig?.resolvedVersionId ?? null,
        latencyMs,
      });

      await deliverCompletionWebhook(p, jobService, output, latencyMs);

      return {
        text: result.text,
        language: result.matchedVariant ?? null,
        durationSec: null,
        segments: null,
        outputS3Key: null,
        languageDetected: false,
        languageDetectionConfidence: null,
        systemAnnouncement: true,
      };
    }

    const latencyMs = Date.now() - startedAt;
    const audioMinutes = result.durationSec ? result.durationSec / 60 : 0;
    const languageDetected = result.languageDetected ?? false;
    const languageDetectionConfidence = result.languageDetectionConfidence ?? null;

    const outputExtras: Record<string, unknown> = {};
    if (result.segments) outputExtras.segments = result.segments;
    if (languageDetected) {
      outputExtras.languageDetected = true;
      if (languageDetectionConfidence !== null) outputExtras.languageDetectionConfidence = languageDetectionConfidence;
    }

    // Persist the transcript to our S3 bucket (tenant-scoped output folder). Best-effort.
    let outputS3Key: string | null = null;
    try {
      outputS3Key = `transcription/${p.tenantFolder}/${p.jobId}/output/output.json`;
      const body = Buffer.from(
        JSON.stringify(
          {
            jobId: p.jobId,
            text: result.text,
            language: result.language ?? null,
            durationSec: result.durationSec ?? null,
            languageDetected,
            languageDetectionConfidence,
            segments: result.segments ?? null,
          },
          null,
          2
        ),
        'utf8'
      );
      await new S3Service().uploadBuffer(outputS3Key, body, 'application/json');
    } catch (e) {
      logger.warn({ tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e }, 'Failed to persist transcript to S3');
      outputS3Key = null;
    }

    await jobService.complete(p.jobId, {
      transcript: result.text,
      language: result.language,
      durationSec: result.durationSec,
      output: Object.keys(outputExtras).length > 0 ? outputExtras : undefined,
      outputS3Key,
      providerVersionId: modelConfig?.resolvedVersionId ?? null,
      latencyMs,
    });
    // Independent of each other — run concurrently instead of sequentially so the slower of
    // the two (typically the webhook, an outbound HTTP call to the client's own endpoint)
    // doesn't add its full latency on top of the other's.
    await Promise.all([
      TranscriptionApiKeyService.recordAudioMinutes(db, p.apiKeyId, audioMinutes).catch((e) => {
        logger.warn(
          { tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e },
          'Failed to record audio minutes'
        );
      }),
      deliverCompletionWebhook(
        p,
        jobService,
        {
          text: result.text,
          language: result.language,
          durationSec: result.durationSec,
          ...(result.segments ? { segments: result.segments } : {}),
          ...(languageDetected ? { languageDetected, languageDetectionConfidence } : {}),
        },
        latencyMs
      ),
    ]);

    return {
      text: result.text,
      language: result.language ?? null,
      durationSec: result.durationSec ?? null,
      segments: result.segments ?? null,
      outputS3Key,
      languageDetected,
      languageDetectionConfidence,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const isFinalAttempt = p.isFinalAttempt ?? true;
    logger.error(
      { tenantId: p.tenantId, jobId: p.jobId, errorName: error.name, errorMessage: error.message, latencyMs: Date.now() - startedAt, isFinalAttempt },
      isFinalAttempt ? 'Transcription execution failed (final attempt, no more retries)' : 'Transcription execution failed, will retry'
    );

    // Only finalize — mark the job failed and notify the caller — once we know pg-boss
    // has no more retries left. Doing this on every attempt (the old behavior) meant a
    // job that later succeeded on retry had already told the caller it failed, and a job
    // that kept failing fired a duplicate webhook per attempt instead of exactly once.
    if (isFinalAttempt) {
      await jobService.fail(p.jobId, error.message, Date.now() - startedAt).catch((e) =>
        logger.warn({ tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e }, 'Failed to mark job failed')
      );
      if (p.webhookUrl) {
        // The circuit breaker's own error message talks about "retry in Xs" — accurate for
        // an in-progress attempt, but misleading here: this IS the final attempt, nothing
        // will retry. The webhook gets a plain, unambiguous message instead; the raw
        // internal message (with host/timing detail) is still what we log and store on the
        // job row above, for our own debugging.
        const webhookErrorMessage =
          error.name === 'EngineCircuitOpenError'
            ? `Transcription engine unreachable${p.totalAttempts ? ` after ${p.totalAttempts} attempts` : ''} — not processed`
            : error.message;
        await new WebhookService()
          .deliverWithToken(p.webhookUrl, p.webhookSecret ?? null, {
            executionId: p.jobId,
            agentId: '',
            ...(p.uploadId ? { uploadId: p.uploadId } : {}),
            ...(p.clientReference ? { clientReference: p.clientReference } : {}),
            status: 'failed',
            input: { fileName: p.fileName, mimeType: p.mimeType, s3Key: p.s3Key ?? null },
            error: webhookErrorMessage,
            cacheHit: false,
            timestamp: new Date().toISOString(),
          })
          .then(async (d) => {
            await jobService.setWebhookResult(p.jobId, d.success);
            if (!d.success && p.onWebhookFailure) {
              await p.onWebhookFailure(p.jobId).catch((e) =>
                logger.warn({ tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e }, 'Failed to enqueue webhook retry')
              );
            }
          })
          .catch((e) =>
            logger.warn({ tenantId: p.tenantId, jobId: p.jobId, err: e instanceof Error ? e.message : e }, 'Failure-path webhook delivery threw')
          );
      }
    }
    throw error;
  }
}
