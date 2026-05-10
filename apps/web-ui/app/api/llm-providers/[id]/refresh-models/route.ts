import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new LlmProviderService(tenantId);
    const provider = await service.refreshModels(id, (providerType, credentials, region) =>
      createDiscovery(providerType as any).discover(credentials, region)
    );

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    return NextResponse.json(provider);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
