import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionModelService,
  createTranscriptionModelSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const service = new TranscriptionModelService(tenantId);
    const models = await service.list();
    return NextResponse.json(models);
  } catch (error) {
    logger.error({ error }, 'Failed to list transcription models');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = createTranscriptionModelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new TranscriptionModelService(tenantId);
    const model = await service.create(parsed.data);
    logger.info({ tenantId, modelId: model.id }, 'Created transcription model');
    return NextResponse.json(model, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create transcription model');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'A model with this name already exists' }, { status: 409 });
    }
    if (error instanceof Error && (error.message.includes('endpoint') || error.message.includes('gateway'))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
