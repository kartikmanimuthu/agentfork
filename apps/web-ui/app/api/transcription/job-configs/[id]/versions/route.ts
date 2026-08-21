import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionJobConfigService,
  TranscriptionJobVersionService,
  createTranscriptionJobVersionSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:job-configs:versions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJobVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const configService = new TranscriptionJobConfigService(tenantId);
    const config = await configService.findById(id);
    if (!config) return NextResponse.json({ error: 'Job config not found' }, { status: 404 });

    const versions = await new TranscriptionJobVersionService().findByJobConfigId(id);
    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list transcription job versions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TranscriptionJobVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = createTranscriptionJobVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const configService = new TranscriptionJobConfigService(tenantId);
    const config = await configService.findById(id);
    if (!config) return NextResponse.json({ error: 'Job config not found' }, { status: 404 });

    const snapshot = {
      name: config.name,
      description: config.description,
      modelId: config.modelId,
      versionId: config.versionId,
      config: config.config,
    };

    const version = await new TranscriptionJobVersionService().create(id, snapshot, parsed.data.changeNotes);
    logger.info({ tenantId, jobConfigId: id, versionId: version.id }, 'Created transcription job version snapshot');
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to create transcription job version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
