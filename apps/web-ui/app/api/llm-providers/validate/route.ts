import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { ValidateInputSchema } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = ValidateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const result = await service.validateAndDiscoverModels(parsed.data, (providerType, credentials, region) =>
      createDiscovery(providerType as any).discover(credentials, region)
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Discovery failed' },
      { status: 200 }
    );
  }
}
