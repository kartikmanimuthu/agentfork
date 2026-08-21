import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionModelService, createLogger } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:refresh');

/** Re-scan a saved provider's models and persist the result. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new TranscriptionModelService(tenantId);
    const model = await service.refreshModels(id, (providerType, credentials, region) =>
      createDiscovery(providerType as never).discover(credentials, region)
    );
    if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(model);
  } catch (error) {
    logger.error({ error }, 'Refresh transcription models failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
