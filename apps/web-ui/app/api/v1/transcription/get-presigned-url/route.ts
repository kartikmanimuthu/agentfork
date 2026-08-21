import { NextRequest } from 'next/server';
import {
  createLogger,
  getPrismaClient,
  TranscriptionApiKeyService,
  createTranscriptionUploadSchema,
} from '@chatbot/shared';
import { TranscriptionUploadService } from '@chatbot/shared/server';
import { validateTranscriptionApiKey } from '../lib/auth';

const logger = createLogger('api:transcription:get-presigned-url');

/**
 * Presign API (two-API flow, step 1).
 *
 * Returns a presigned POST policy the caller uses to upload audio **directly to S3** —
 * bytes never transit this server. The policy's `content-length-range` and `Content-Type`
 * conditions are enforced by S3 itself and are covered by the signature, so the caller can
 * read the limits but cannot raise them.
 *
 * The returned `uploadId` is the caller's stable identifier: pass it to
 * POST /api/v1/transcription, receive it back on the webhook, and use it to fetch the
 * transcript later from GET /api/v1/transcription/transcripts.
 *
 * Auth: Bearer transcription API key.
 */
export async function POST(req: NextRequest) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;
  const { tenantId, apiKeyId, apiKey: keyLimits } = authResult.auth;

  try {
    const body = await req.json().catch(() => null);
    const parsed = createTranscriptionUploadSchema.safeParse(body ?? {});
    if (!parsed.success) {
      logger.warn({ tenantId, apiKeyId, issue: parsed.error.issues[0]?.message }, 'Presign validation failed');
      return jsonError('validation_error', parsed.error.issues[0]?.message ?? 'Invalid request body', 400);
    }

    // Presigning costs us only a signature, so bytes never flow through here and there is no
    // natural throttle on abuse — meter it against the key's per-minute/daily request budget.
    const db = getPrismaClient();
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
      return new Response(JSON.stringify({ error: { type: 'quota_exceeded', message: quota.reason } }), {
        status: 429,
        headers,
      });
    }

    const result = await new TranscriptionUploadService(tenantId, db).createPresigned({
      apiKeyId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      clientReference: parsed.data.clientReference,
      declaredSizeBytes: parsed.data.declaredSizeBytes,
      expiresInSeconds: parsed.data.expiresInSeconds,
    });

    logger.info({ tenantId, apiKeyId, uploadId: result.uploadId }, 'Presigned upload issued');

    return new Response(
      JSON.stringify({
        uploadId: result.uploadId,
        url: result.url,
        // Send every field verbatim as multipart/form-data, with `file` LAST — S3 ignores
        // any field that appears after it, and altering a field invalidates the signature.
        fields: result.fields,
        method: 'POST',
        expiresInSeconds: result.expiresInSeconds,
        expiresAt: result.expiresAt.toISOString(),
        maxBytes: result.maxBytes,
        s3Key: result.s3Key,
        clientReference: result.clientReference,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (/exceeds the .*MB limit/.test(err.message)) {
      return jsonError('payload_too_large', err.message, 413);
    }
    logger.error({ err, errorMessage: err.message, tenantId, apiKeyId }, 'Failed to presign upload');
    return jsonError('internal_error', 'Failed to create upload', 500);
  }
}

function jsonError(type: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
