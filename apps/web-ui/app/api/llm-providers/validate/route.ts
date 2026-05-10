import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService, createLogger } from '@chatbot/shared';
import { ValidateInputSchema } from '@chatbot/shared';
import { createDiscovery } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:llm-providers:validate');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    logger.info(
      { tenantId, providerType: body.providerType, region: body.region, baseUrl: body.credentials?.baseUrl },
      'Received provider validation request'
    );

    const parsed = ValidateInputSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Validation schema rejected input');
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const result = await service.validateAndDiscoverModels(parsed.data, (providerType, credentials, region) =>
      createDiscovery(providerType as any).discover(credentials, region)
    );
    logger.info(
      { tenantId, providerType: parsed.data.providerType, modelCount: result.models?.length },
      'Provider validation succeeded'
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    logger.error({ error: message }, 'Provider validation failed');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: 200 }
    );
  }
}
