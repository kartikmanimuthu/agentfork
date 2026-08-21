import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  TranscriptionJobConfigService,
  TranscriptionJobVersionService,
  TranscriptionApiKeyService,
  createTranscriptionJobConfigSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:job-configs');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Number(searchParams.get('pageSize') ?? '20');

    const service = new TranscriptionJobConfigService(tenantId);
    const result = await service.findMany({ search, status, page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list transcription job configs');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const parsed = createTranscriptionJobConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new TranscriptionJobConfigService(tenantId);
    const config = await service.create(parsed.data);

    // Create an initial draft version snapshot.
    await new TranscriptionJobVersionService().create(config.id, {
      name: config.name,
      description: config.description,
      modelId: config.modelId,
      versionId: config.versionId,
      config: config.config,
    }, 'Initial version');

    logger.info({ tenantId, jobConfigId: config.id, userId }, 'Created transcription job config');
    return NextResponse.json(config, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'A job with this name already exists' }, { status: 409 });
    }
    if (error instanceof Error && (error.message.includes('Transcription model not found') || error.message.includes('Transcription model version not found'))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'Failed to create transcription job config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
