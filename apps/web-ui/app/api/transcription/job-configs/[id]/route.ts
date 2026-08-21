import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  getSessionTenantId,
  authorize,
  TranscriptionJobConfigService,
  updateTranscriptionJobConfigSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:job-configs:[id]');

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new TranscriptionJobConfigService(tenantId);
    const config = await service.findById(id);
    if (!config) {
      return NextResponse.json({ error: 'Job config not found' }, { status: 404 });
    }
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to fetch transcription job config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = updateTranscriptionJobConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new TranscriptionJobConfigService(tenantId);
    const config = await service.update(id, parsed.data);
    logger.info({ tenantId, jobConfigId: id }, 'Updated transcription job config');
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && (error.message.includes('Transcription model not found') || error.message.includes('Transcription model version not found'))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isRecordNotFound(error)) {
      return NextResponse.json({ error: 'Job config not found' }, { status: 404 });
    }
    logger.error({ error }, 'Failed to update transcription job config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new TranscriptionJobConfigService(tenantId);
    await service.delete(id);
    logger.info({ tenantId, jobConfigId: id }, 'Deleted transcription job config');
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (isRecordNotFound(error)) {
      return NextResponse.json({ error: 'Job config not found' }, { status: 404 });
    }
    logger.error({ error }, 'Failed to delete transcription job config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
