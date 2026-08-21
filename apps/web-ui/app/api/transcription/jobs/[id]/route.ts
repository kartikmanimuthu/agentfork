import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionJobService, getPrismaClient, createLogger } from '@chatbot/shared';
import { S3Service } from '@chatbot/shared/server';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:jobs:[id]');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJob', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const job = await new TranscriptionJobService(getPrismaClient()).findById(id, tenantId);
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Generate a fresh, short-lived playback URL on demand — never cached or persisted,
    // only produced when this job's details are actually requested.
    const audioKey = job.inputS3Key ?? (job.source !== 's3' ? job.s3Key : null);
    let inputAudioUrl: string | null = null;
    if (audioKey) {
      try {
        inputAudioUrl = await new S3Service().getDownloadUrl(audioKey, 900);
      } catch (e) {
        logger.warn({ jobId: id, err: e instanceof Error ? e.message : e }, 'Failed to generate playback URL for job audio');
      }
    }

    return NextResponse.json({ ...job, inputAudioUrl });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Failed to fetch transcription job');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
