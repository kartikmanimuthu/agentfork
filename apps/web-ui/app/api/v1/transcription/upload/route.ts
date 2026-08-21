import { NextRequest } from 'next/server';
import { createLogger, env, getPrismaClient } from '@chatbot/shared';
import { S3Service } from '@chatbot/shared/server';
import crypto from 'crypto';
import { validateTranscriptionApiKey } from '../lib/auth';

const logger = createLogger('api:transcription:upload');

/**
 * Direct upload API — the caller streams the audio through us and we store it in our S3
 * bucket, returning an `uploadId` to pass to POST /api/v1/transcription.
 *
 * This is the simpler of the two upload styles and is retained for small files and quick
 * testing. For anything at volume prefer POST /api/v1/transcription/get-presigned-url, which returns a
 * presigned POST so the bytes go straight to S3 without passing through this process (and
 * which can enforce the size cap at upload time rather than at transcribe time).
 *
 * multipart/form-data: field `file`. Auth: Bearer transcription API key.
 */
export async function POST(req: NextRequest) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;
  const { tenantId, apiKeyId } = authResult.auth;

  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('validation_error', 'Use multipart/form-data with a "file" field', 400);
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonError('validation_error', 'multipart/form-data must include a "file" field', 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const maxBytes = env.TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;
    if (buffer.length === 0) return jsonError('validation_error', 'Empty file', 400);
    if (buffer.length > maxBytes) {
      return jsonError('payload_too_large', `Audio exceeds ${env.TRANSCRIPTION_MAX_AUDIO_MB}MB`, 413);
    }

    // Staged under a tenant-scoped, job-less holding area (server derives tenantId,
    // never trust the client) — moved to transcription/{tenantFolder}/{jobId}/input/
    // once a transcription job actually claims it.
    const safeName = (file.name || 'audio').replace(/[^\w.\-]+/g, '_').slice(-120);
    const s3Key = `transcription/_uploads/${tenantId}/${crypto.randomUUID()}-${safeName}`;
    const mimeType = file.type || 'application/octet-stream';

    const s3 = new S3Service();
    await s3.uploadBuffer(s3Key, buffer, mimeType);
    const downloadUrl = await s3.getDownloadUrl(s3Key, 900);

    // Record the upload so it carries the same stable `uploadId` as the presigned flow —
    // one identifier concept regardless of which upload style the caller used.
    const db = getPrismaClient();
    const clientReference = (form.get('clientReference') as string) || null;
    const upload = await db.transcriptionUpload.create({
      data: {
        tenantId,
        apiKeyId,
        s3Key,
        fileName: file.name || null,
        mimeType,
        declaredSizeBytes: buffer.length,
        clientReference,
        status: 'pending',
        expiresAt: new Date(Date.now() + env.TRANSCRIPTION_UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    logger.info({ tenantId, apiKeyId, uploadId: upload.id, s3Key, sizeBytes: buffer.length }, 'Audio uploaded to tenant input folder');

    return new Response(
      JSON.stringify({
        uploadId: upload.id,
        s3Key,
        downloadUrl,
        expiresInSeconds: 900,
        fileName: file.name,
        mimeType,
        sizeBytes: buffer.length,
        clientReference,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err, errorMessage: err.message, tenantId, apiKeyId }, 'Upload failed');
    return jsonError('internal_error', 'Upload failed', 500);
  }
}

function jsonError(type: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
