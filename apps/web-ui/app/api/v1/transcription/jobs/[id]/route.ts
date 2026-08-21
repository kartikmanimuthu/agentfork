import { NextRequest, NextResponse } from 'next/server';
import { TranscriptionJobService, getPrismaClient, createLogger } from '@chatbot/shared';
import { validateTranscriptionApiKey } from '../../lib/auth';

const logger = createLogger('api:transcription:jobs:[id]');

/** Poll a transcription job's status/result (companion to webhooks). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId, apiKeyId } = authResult.auth;

  try {
    const { id } = await params;
    const service = new TranscriptionJobService(getPrismaClient());
    const job = await service.findById(id, tenantId);

    // A key may only read its own jobs.
    if (!job || job.apiKeyId !== apiKeyId) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Job not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      source: job.source,
      text: job.transcript,
      language: job.language,
      durationSec: job.durationSec,
      output: job.output,
      error: job.error,
      latencyMs: job.latencyMs,
      webhookStatus: job.webhookStatus,
      webhookAttempts: job.webhookAttempts,
      outputS3Key: job.outputS3Key,
      providerVersionId: job.providerVersionId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (error) {
    logger.error({ err: error, apiKeyId }, 'Failed to fetch transcription job');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to fetch job' } },
      { status: 500 }
    );
  }
}
