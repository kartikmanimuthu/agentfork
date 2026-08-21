import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionApiKeyService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:api-keys:[id]');

/** POST with { action: 'rotate' } rotates the key; default POST revokes it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const service = new TranscriptionApiKeyService(tenantId);

    if (body?.action === 'rotate') {
      const { rawKey, apiKey } = await service.rotate(id);
      logger.info({ tenantId, apiKeyId: apiKey.id }, 'Transcription API key rotated');
      return NextResponse.json({ rawKey, apiKey: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix } });
    }

    await service.revoke(id);
    logger.info({ tenantId, apiKeyId: id }, 'Transcription API key revoked');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to update transcription API key');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'TranscriptionApiKey', authOptions);
    if (authError) return authError;

    const { id } = await params;
    await new TranscriptionApiKeyService(tenantId).delete(id);
    logger.info({ tenantId, apiKeyId: id }, 'Transcription API key deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete transcription API key');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
