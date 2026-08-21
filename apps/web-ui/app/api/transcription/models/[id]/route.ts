import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionModelService,
  updateTranscriptionModelSchema,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:[id]');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const model = await new TranscriptionModelService(tenantId).findById(id);
    if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(model);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch transcription model');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateTranscriptionModelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new TranscriptionModelService(tenantId);
    // A bare { isDefault: true } toggles default without touching other fields.
    const model =
      Object.keys(parsed.data).length === 1 && parsed.data.isDefault
        ? await service.setDefault(id)
        : await service.update(id, parsed.data);
    if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(model);
  } catch (error) {
    logger.error({ error }, 'Failed to update transcription model');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const deleted = await new TranscriptionModelService(tenantId).delete(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete transcription model');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
