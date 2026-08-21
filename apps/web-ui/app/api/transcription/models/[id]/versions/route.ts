import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  TranscriptionModelVersionService,
  createTranscriptionModelVersionSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:versions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const versions = await new TranscriptionModelVersionService(tenantId).list(id);
    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    logger.error({ error }, 'List transcription model versions failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Snapshot the model's current config as a new draft version. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = createTranscriptionModelVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const version = await new TranscriptionModelVersionService(tenantId).create(id, parsed.data.changeNotes, userId);
    logger.info({ tenantId, modelId: id, versionId: version.id }, 'Created transcription model version');
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    logger.error({ error }, 'Create transcription model version failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
