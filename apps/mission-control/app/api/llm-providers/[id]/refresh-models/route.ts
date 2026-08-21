import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { LlmProviderService, createLogger } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:llm-providers:refresh-models');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;
    const { id } = await params;
    logger.info({ tenantId, providerId: id }, 'Refreshing provider models');

    const service = new LlmProviderService(tenantId);
    const provider = await service.refreshModels(id, (providerType, credentials, region) =>
      createDiscovery(providerType as never).discover(credentials, region),
    );

    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found for refresh');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    logger.info({ tenantId, providerId: id }, 'Refreshed provider models');
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to refresh provider models');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
