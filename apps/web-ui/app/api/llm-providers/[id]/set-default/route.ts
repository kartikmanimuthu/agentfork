import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:llm-providers:set-default');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, providerId: id }, 'Setting default LLM provider');
    const service = new LlmProviderService(tenantId);
    const provider = await service.setDefault(id);

    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found for set-default');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    logger.info({ tenantId, providerId: id }, 'Set default LLM provider');
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to set default LLM provider');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
