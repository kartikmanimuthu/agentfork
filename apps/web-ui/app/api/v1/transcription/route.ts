import { NextRequest } from 'next/server';
import {
  getPrismaClient,
  createLogger,
  TranscriptionApiKeyService,
  TranscriptionJobService,
  TranscriptionJobConfigService,
  transcriptionRequestSchema,
  resolveTenantFolder,
  withTimeout,
  env,
} from '@chatbot/shared';
import {
  S3Service,
  TranscriptionUploadService,
  detectAudioFormat,
  executeTranscription,
  dispatchUploadedTranscription,
  PayloadTooLargeError,
} from '@chatbot/shared/server';
import { transcribeAudio } from '@chatbot/ai';
import { validateTranscriptionApiKey } from './lib/auth';
import { enqueueJob } from '@/lib/boss';

const logger = createLogger('api:transcription');

type Common = {
  fileName?: string;
  mimeType: string;
  language?: string;
  webhookUrl?: string;
  sync: boolean;
  modelId?: string | null;
  versionId?: string | null;
  diarize?: boolean;
};
type Parsed =
  | ({ source: 'upload'; s3Key: string; uploadId?: string; clientReference?: string } & Common)
  | ({ source: 'payload'; buffer: Buffer } & Common);

function keyFromS3Url(s3Url: string, bucket: string): string | null {
  try {
    let path = decodeURIComponent(new URL(s3Url).pathname).replace(/^\/+/, '');
    if (env.S3_FORCE_PATH_STYLE === 'true' && path.startsWith(`${bucket}/`)) {
      path = path.slice(bucket.length + 1);
    }
    return path || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId, apiKeyId, jobConfigId: keyJobConfigId, modelId: keyModelId, apiKey: keyLimits } = authResult.auth;
  const db = getPrismaClient();
  const startedAt = Date.now();
  const maxBytes = env.TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;
  const stagingPrefix = `transcription/_uploads/${tenantId}/`;

  try {
    // Bounded so a stalled DB connection turns into a clean 500 for this one caller instead
    // of leaving their HTTP request hanging open indefinitely.
    const tenantFolder = await withTimeout(
      resolveTenantFolder(tenantId, db),
      30_000,
      `Resolving tenant folder timed out for tenant ${tenantId}`
    );

    let resolvedJobConfig: { id: string; modelId: string | null; versionId: string | null; config: unknown } | null = null;
    if (keyJobConfigId) {
      resolvedJobConfig = await new TranscriptionJobConfigService(tenantId, db).findById(keyJobConfigId) ?? null;
    }
    const quota = await TranscriptionApiKeyService.checkQuota(db, apiKeyId, {
      dailyReqLimit: keyLimits.dailyReqLimit,
      dailyMinutesLimit: keyLimits.dailyMinutesLimit,
      minuteReqLimit: keyLimits.minuteReqLimit,
    });
    if (!quota.allowed) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
        'X-RateLimit-Remaining': String(quota.remainingRequests ?? 0),
      };
      if (quota.retryAfter) headers['Retry-After'] = String(quota.retryAfter);
      return new Response(JSON.stringify({ error: { type: 'quota_exceeded', message: quota.reason } }), { status: 429, headers });
    }
    await TranscriptionApiKeyService.reserveRequest(db, apiKeyId);

    // ─── Parse: multipart (payload) OR JSON (upload-ref | payload) ───────────
    const contentType = req.headers.get('content-type') ?? '';
    let parsed: Parsed;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return jsonError('validation_error', 'multipart/form-data must include a "file" field', 400);
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > maxBytes) return jsonError('payload_too_large', `Audio exceeds ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB`, 413);
      const syncRaw = form.get('sync');
      parsed = {
        source: 'payload',
        buffer,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
        language: (form.get('language') as string) || undefined,
        webhookUrl: (form.get('webhookUrl') as string) || undefined,
        sync: syncRaw === null ? true : syncRaw !== 'false',
        modelId: (form.get('modelId') as string) || undefined,
        versionId: (form.get('versionId') as string) || undefined,
        diarize: form.get('diarize') === 'true',
      };
    } else {
      const body = await req.json().catch(() => null);
      const result = transcriptionRequestSchema.safeParse(body);
      if (!result.success) {
        logger.warn({ tenantId, apiKeyId, issue: result.error.issues[0]?.message }, 'Transcription request validation failed');
        return jsonError('validation_error', result.error.issues[0]?.message ?? 'Invalid request body', 400);
      }
      const data = result.data as Record<string, unknown> & {
        audio?: string; mimeType?: string; fileName?: string;
        uploadId?: string;
        s3Key?: string; s3Url?: string; language?: string; webhookUrl?: string;
        sync?: boolean; modelId?: string; versionId?: string; diarize?: boolean;
      };
      const sync = data.sync !== false; // default true
      const common = {
        language: data.language, webhookUrl: data.webhookUrl, sync,
        modelId: data.modelId, versionId: data.versionId, diarize: data.diarize,
      };

      if (data.uploadId) {
        // ─── Preferred path: an upload minted by POST /api/v1/transcription/get-presigned-url ───
        const uploadService = new TranscriptionUploadService(tenantId, db);
        const upload = await uploadService.findById(data.uploadId);
        // Tenant mismatch is indistinguishable from absent — deliberate, so the endpoint
        // can't be used to probe for other tenants' upload ids.
        if (!upload) return jsonError('upload_not_found', 'No upload found for this uploadId', 404);

        if (upload.status === 'consumed') {
          // Idempotent: a retried submit returns the job already created for this upload
          // rather than duplicating work (also enforced by the unique index on uploadId).
          const existing = upload.jobs[0];
          if (existing) {
            const job = await db.transcriptionJob.findUnique({ where: { id: existing.id } });
            if (job) {
              logger.info({ tenantId, apiKeyId, uploadId: upload.id, jobId: job.id }, 'Returning existing job for consumed upload');
              return new Response(
                JSON.stringify({
                  id: job.id,
                  transcriptionId: job.id,
                  uploadId: upload.id,
                  clientReference: upload.clientReference,
                  status: job.status,
                  statusUrl: `/api/v1/transcription/jobs/${job.id}`,
                }),
                { status: 200, headers: { 'Content-Type': 'application/json', 'X-Job-Id': job.id } }
              );
            }
          }
          return jsonError('upload_already_consumed', 'This upload has already been transcribed', 409);
        }

        if (upload.status === 'expired' || upload.expiresAt.getTime() < Date.now()) {
          return jsonError('upload_expired', 'This upload window has expired; request a new upload', 410);
        }

        // Confirm the caller actually completed their POST to S3, and enforce the size cap
        // here (a presign policy caps it too, but this also covers legacy/edge paths and
        // happens before any GPU time is spent).
        const s3 = new S3Service();
        const head = await s3.headObject(upload.s3Key);
        if (!head) {
          return jsonError(
            'upload_incomplete',
            'No object found for this upload — confirm your upload returned 201 before calling transcribe',
            409
          );
        }
        if (head.contentLength !== null && head.contentLength > maxBytes) {
          return jsonError('payload_too_large', `Audio exceeds ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB`, 413);
        }

        // Verify the real container from magic bytes. The presign policy only pins the
        // client-declared Content-Type; S3 never inspects the body.
        const leadingBytes = await s3.getObjectHead(upload.s3Key, 12);
        if (leadingBytes && !detectAudioFormat(leadingBytes)) {
          logger.warn({ tenantId, apiKeyId, uploadId: upload.id }, 'Rejected upload failing magic-byte check');
          return jsonError('unsupported_media_type', 'Uploaded file is not a valid MP3, WAV, M4A, or AMR audio file', 415);
        }

        await uploadService.markConsumed(upload.id, head.contentLength ?? null);

        parsed = {
          source: 'upload',
          s3Key: upload.s3Key,
          uploadId: upload.id,
          clientReference: upload.clientReference ?? undefined,
          mimeType: head.contentType ?? upload.mimeType,
          fileName: upload.fileName ?? upload.s3Key.split('/').pop(),
          ...common,
        };
      } else if (data.s3Key || data.s3Url) {
        const s3 = new S3Service();
        const s3Key = data.s3Key ?? keyFromS3Url(data.s3Url!, s3.getBucket());
        if (!s3Key) return jsonError('validation_error', 'Could not resolve s3Key from s3Url', 400);
        if (!s3Key.startsWith(stagingPrefix)) {
          logger.warn({ tenantId, apiKeyId, s3Key }, 'Rejected s3Key outside tenant prefix');
          return jsonError('validation_error', 's3Key does not belong to this tenant', 403);
        }
        const headMimeType = await s3.headContentType(s3Key);
        parsed = { source: 'upload', s3Key, mimeType: headMimeType ?? 'application/octet-stream', fileName: s3Key.split('/').pop(), ...common };
      } else {
        const buffer = Buffer.from(data.audio!, 'base64');
        if (buffer.length === 0) return jsonError('validation_error', 'Decoded audio is empty', 400);
        if (buffer.length > maxBytes) return jsonError('payload_too_large', `Audio exceeds ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB`, 413);
        parsed = { source: 'payload', buffer, mimeType: data.mimeType ?? 'application/octet-stream', fileName: data.fileName, ...common };
      }
    }

    const webhookUrl = parsed.webhookUrl ?? keyLimits.webhookUrl ?? null;
    const effectiveModelId = parsed.modelId ?? resolvedJobConfig?.modelId ?? keyModelId ?? undefined;
    const providerVersionId = parsed.versionId ?? resolvedJobConfig?.versionId ?? undefined;
    const jobConfigOverrides = (resolvedJobConfig?.config ?? {}) as Record<string, unknown>;
    const effectiveLanguage = parsed.language ?? (jobConfigOverrides.language as string | undefined) ?? undefined;
    const effectiveDiarize = parsed.diarize ?? (jobConfigOverrides.diarize as boolean | undefined);
    const jobService = new TranscriptionJobService(db);

    // ─── ASYNC: create queued job, enqueue, return 202 ───────────────────────
    if (!parsed.sync) {
      if (parsed.source === 'upload') {
        const dispatched = await dispatchUploadedTranscription({
          db, transcribe: transcribeAudio, enqueue: enqueueJob,
          tenantId, tenantFolder, apiKeyId, jobConfigId: keyJobConfigId,
          resolvedJobConfig, keyModelId, keyWebhookUrl: keyLimits.webhookUrl,
          webhookSecret: keyLimits.webhookSecret,
          s3Key: parsed.s3Key, mimeType: parsed.mimeType, fileName: parsed.fileName,
          uploadId: parsed.uploadId, clientReference: parsed.clientReference,
          language: parsed.language, diarize: parsed.diarize,
          webhookUrl: parsed.webhookUrl, modelId: parsed.modelId, versionId: parsed.versionId,
          sync: false, maxBytes,
        });
        logger.info({ tenantId, apiKeyId, jobId: dispatched.id, uploadId: parsed.uploadId, source: parsed.source }, 'Transcription job queued (async)');
        return new Response(
          JSON.stringify({
            id: dispatched.id,
            transcriptionId: dispatched.id,
            ...(parsed.uploadId ? { uploadId: parsed.uploadId } : {}),
            ...(parsed.clientReference ? { clientReference: parsed.clientReference } : {}),
            status: dispatched.status,
            statusUrl: dispatched.statusUrl,
          }),
          { status: 202, headers: { 'Content-Type': 'application/json', 'X-Job-Id': dispatched.id } }
        );
      }

      const job = await jobService.create({
        apiKeyId, tenantId, jobConfigId: keyJobConfigId ?? undefined, modelId: effectiveModelId, providerVersionId,
        source: parsed.source,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.length,
        webhookUrl,
        status: 'queued',
      });

      const s3 = new S3Service();
      const inputFileName = parsed.fileName || 'audio';
      const stashKey = `transcription/${tenantFolder}/${job.id}/input/${inputFileName}`;
      await s3.uploadBuffer(stashKey, parsed.buffer, parsed.mimeType);
      await db.transcriptionJob.update({ where: { id: job.id }, data: { s3Key: stashKey, inputS3Key: stashKey } });

      await enqueueJob('transcription', {
        jobId: job.id, tenantId, apiKeyId, jobConfigId: keyJobConfigId ?? null, modelId: effectiveModelId ?? null,
        versionId: providerVersionId ?? null,
        source: parsed.source,
        stashKey,
        s3Key: null,
        mimeType: parsed.mimeType,
        fileName: parsed.fileName ?? null,
        language: effectiveLanguage ?? null,
        diarize: effectiveDiarize ?? null,
        webhookUrl,
        webhookSecret: keyLimits.webhookSecret,
      });

      logger.info({ tenantId, apiKeyId, jobId: job.id, source: parsed.source }, 'Transcription job queued (async)');
      return new Response(
        JSON.stringify({ id: job.id, status: 'queued', statusUrl: `/api/v1/transcription/jobs/${job.id}` }),
        { status: 202, headers: { 'Content-Type': 'application/json', 'X-Job-Id': job.id } }
      );
    }

    // ─── SYNC: fetch audio, create running job, transcribe, return 200 ────────
    if (parsed.source === 'upload') {
      try {
        const dispatched = await dispatchUploadedTranscription({
          db, transcribe: transcribeAudio, enqueue: enqueueJob,
          tenantId, tenantFolder, apiKeyId, jobConfigId: keyJobConfigId,
          resolvedJobConfig, keyModelId, keyWebhookUrl: keyLimits.webhookUrl,
          webhookSecret: keyLimits.webhookSecret,
          s3Key: parsed.s3Key, mimeType: parsed.mimeType, fileName: parsed.fileName,
          uploadId: parsed.uploadId, clientReference: parsed.clientReference,
          language: parsed.language, diarize: parsed.diarize,
          webhookUrl: parsed.webhookUrl, modelId: parsed.modelId, versionId: parsed.versionId,
          sync: true, maxBytes,
        });
        return new Response(
          JSON.stringify({
            id: dispatched.id,
            transcriptionId: dispatched.id,
            ...(parsed.uploadId ? { uploadId: parsed.uploadId } : {}),
            ...(parsed.clientReference ? { clientReference: parsed.clientReference } : {}),
            systemAnnouncement: dispatched.systemAnnouncement,
            text: dispatched.text,
            language: dispatched.language,
            languageDetected: dispatched.languageDetected,
            languageDetectionConfidence: dispatched.languageDetectionConfidence,
            durationSec: dispatched.durationSec,
            segments: dispatched.segments,
            outputS3Key: dispatched.outputS3Key,
            usage: {
              remainingRequests: (quota.remainingRequests ?? 1) - 1,
              remainingMinutes: Math.max(0, (quota.remainingMinutes ?? 0) - dispatched.audioMinutes),
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Job-Id': dispatched.id,
              'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
              'X-RateLimit-Remaining': String((quota.remainingRequests ?? 1) - 1),
            },
          }
        );
      } catch (engineErr) {
        if (engineErr instanceof PayloadTooLargeError) {
          return jsonError('payload_too_large', `Audio exceeds ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB`, 413);
        }
        const error = engineErr instanceof Error ? engineErr : new Error(String(engineErr));
        logger.error({ tenantId, apiKeyId, latencyMs: Date.now() - startedAt, errorMessage: error.message }, 'Transcription engine failed');
        return jsonError('transcription_error', error.message, 502);
      }
    }

    const audio = parsed.buffer;
    const mimeType = parsed.mimeType;

    const job = await jobService.create({
      apiKeyId, tenantId, jobConfigId: keyJobConfigId ?? undefined, modelId: effectiveModelId, providerVersionId,
      source: parsed.source, fileName: parsed.fileName, mimeType, sizeBytes: audio.length,
      webhookUrl,
    });

    try {
      const result = await executeTranscription(db, transcribeAudio, {
        jobId: job.id, tenantId, tenantFolder, apiKeyId, jobConfigId: keyJobConfigId ?? undefined, modelId: effectiveModelId, versionId: providerVersionId,
        audio, mimeType, fileName: parsed.fileName, s3Key: null,
        language: effectiveLanguage, diarize: effectiveDiarize,
        engineTimeoutMs: env.TRANSCRIPTION_ENGINE_TIMEOUT_MS,
        webhookUrl, webhookSecret: keyLimits.webhookSecret,
        onWebhookFailure: (id) => enqueueWebhookRetry(id, tenantId),
      });
      const audioMinutes = result.durationSec ? result.durationSec / 60 : 0;
      return new Response(
        JSON.stringify({
          id: job.id,
          systemAnnouncement: result.systemAnnouncement ?? false,
          text: result.text,
          language: result.language,
          languageDetected: result.languageDetected,
          languageDetectionConfidence: result.languageDetectionConfidence,
          durationSec: result.durationSec,
          segments: result.segments,
          outputS3Key: result.outputS3Key,
          usage: {
            remainingRequests: (quota.remainingRequests ?? 1) - 1,
            remainingMinutes: Math.max(0, (quota.remainingMinutes ?? 0) - audioMinutes),
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Job-Id': job.id,
            'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
            'X-RateLimit-Remaining': String((quota.remainingRequests ?? 1) - 1),
          },
        }
      );
    } catch (engineErr) {
      const error = engineErr instanceof Error ? engineErr : new Error(String(engineErr));
      logger.error({ tenantId, apiKeyId, jobId: job.id, latencyMs: Date.now() - startedAt, errorMessage: error.message }, 'Transcription engine failed');
      return jsonError('transcription_error', error.message, 502);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err, errorMessage: err.message, tenantId, apiKeyId }, 'Transcription request error');
    return jsonError('internal_error', 'Internal server error', 500);
  }
}

function jsonError(type: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { type, message } }), { status, headers: { 'Content-Type': 'application/json' } });
}

async function enqueueWebhookRetry(jobId: string, tenantId: string): Promise<void> {
  await enqueueJob('transcription-webhook-retry', { jobId, tenantId });
}
