import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService, createLogger } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:llm-providers:refresh-models');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, providerId: id }, 'Refreshing provider models');

    const service = new LlmProviderService(tenantId);
    const provider = await service.refreshModels(id, (providerType, credentials, region) =>
      createDiscovery(providerType as any).discover(credentials, region)
    );

    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found for refresh');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    logger.info({ tenantId, providerId: id }, 'Refreshed provider models');
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to refresh provider models');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
