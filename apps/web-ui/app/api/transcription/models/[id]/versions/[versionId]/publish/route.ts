import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionModelVersionService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:versions:publish');

/** Publish a version and point the model's activeVersionId at it. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id, versionId } = await params;
    const version = await new TranscriptionModelVersionService(tenantId).publish(id, versionId);
    if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    logger.error({ error }, 'Publish transcription model version failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
