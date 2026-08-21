import { NextRequest } from 'next/server';
import { createLogger, getPrismaClient, getTranscriptQuerySchema } from '@chatbot/shared';
import { S3Service } from '@chatbot/shared/server';
import { validateTranscriptionApiKey } from '../lib/auth';

const logger = createLogger('api:transcription:transcripts');

/** Above this, return a presigned link to the stored transcript JSON instead of inlining it. */
const INLINE_TRANSCRIPT_LIMIT_BYTES = 256 * 1024;

interface TranscriptionOutput {
  segments?: Array<{ start?: number; end?: number; speaker?: string; text: string }> | null;
  languageDetected?: boolean;
  languageDetectionConfidence?: number;
  /** True when this job matched a known non-conversational system announcement
   *  instead of being a real transcript — see libs/ai/src/transcription.ts. */
  systemAnnouncement?: boolean;
  matchedVariant?: string;
  matchConfidence?: number;
}

/**
 * Transcript retrieval (two-API flow, step 3 — optional).
 *
 * `GET /api/v1/transcription/transcripts?uploadId=...` (or `?transcriptionId=...`) returns the
 * transcript for a completed job at any point later. Query params rather than a path segment
 * because both lookup modes stay symmetrical this way.
 *
 * Strictly tenant-scoped: every lookup is filtered by the tenant resolved from the API key,
 * and a row belonging to another tenant returns **404, not 403**, so the endpoint cannot be
 * used to confirm the existence of another tenant's ids.
 */
export async function GET(req: NextRequest) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;
  const { tenantId, apiKeyId } = authResult.auth;

  try {
    const { searchParams } = new URL(req.url);
    const parsed = getTranscriptQuerySchema.safeParse({
      uploadId: searchParams.get('uploadId') ?? undefined,
      transcriptionId: searchParams.get('transcriptionId') ?? undefined,
    });
    if (!parsed.success) {
      return jsonError('validation_error', parsed.error.issues[0]?.message ?? 'Invalid query', 400);
    }

    const db = getPrismaClient();
    const { uploadId, transcriptionId } = parsed.data;

    const job = await db.transcriptionJob.findFirst({
      where: {
        tenantId,
        ...(transcriptionId ? { id: transcriptionId } : { uploadId }),
      },
      include: { upload: { select: { id: true, clientReference: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!job) {
      // Distinguish "we have your upload but you never asked us to transcribe it" from
      // "we have no idea what this is" — both are still tenant-scoped lookups.
      if (uploadId) {
        const upload = await db.transcriptionUpload.findFirst({
          where: { id: uploadId, tenantId },
          select: { id: true, status: true, clientReference: true, createdAt: true },
        });
        if (upload) {
          return Response.json(
            {
              uploadId: upload.id,
              clientReference: upload.clientReference,
              transcriptionId: null,
              status: 'not_requested',
              message: 'This upload exists but no transcription has been requested for it yet',
              createdAt: upload.createdAt.toISOString(),
            },
            { status: 200 }
          );
        }
      }
      logger.info({ tenantId, apiKeyId, uploadId, transcriptionId }, 'Transcript lookup miss');
      return jsonError('not_found', 'No transcription found for the supplied identifier', 404);
    }

    const output = (job.output ?? null) as TranscriptionOutput | null;
    const transcript = job.transcript ?? null;
    const inlineTooLarge =
      transcript !== null && Buffer.byteLength(transcript, 'utf8') > INLINE_TRANSCRIPT_LIMIT_BYTES;

    let transcriptUrl: string | null = null;
    if (inlineTooLarge && job.outputS3Key) {
      try {
        transcriptUrl = await new S3Service().getDownloadUrl(job.outputS3Key, 900);
      } catch (e) {
        logger.warn(
          { tenantId, jobId: job.id, err: e instanceof Error ? e.message : e },
          'Failed to presign stored transcript'
        );
      }
    }

    return Response.json(
      {
        transcriptionId: job.id,
        uploadId: job.uploadId,
        clientReference: job.upload?.clientReference ?? null,
        status: job.status,
        fileName: job.fileName,
        mimeType: job.mimeType,
        language: job.language,
        durationSec: job.durationSec,
        // Omitted in favour of transcriptUrl when the transcript is very large.
        transcript: transcriptUrl ? null : transcript,
        transcriptUrl,
        systemAnnouncement: output?.systemAnnouncement ?? false,
        matchedVariant: output?.matchedVariant ?? null,
        matchConfidence: output?.matchConfidence ?? null,
        segments: output?.segments ?? null,
        languageDetected: output?.languageDetected ?? false,
        languageDetectionConfidence: output?.languageDetectionConfidence ?? null,
        error: job.error,
        outputS3Key: job.outputS3Key,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err, errorMessage: err.message, tenantId, apiKeyId }, 'Transcript retrieval failed');
    return jsonError('internal_error', 'Failed to retrieve transcript', 500);
  }
}

function jsonError(type: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
