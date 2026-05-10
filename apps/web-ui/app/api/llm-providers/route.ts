import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService, createLogger } from '@chatbot/shared';
import { CreateLlmProviderSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:llm-providers');

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'LlmProviders', authOptions);
    if (authError) return authError;

    const service = new LlmProviderService(tenantId);
    const providers = await service.list();
    logger.info({ tenantId, count: providers.length }, 'Listed LLM providers');
    return NextResponse.json(providers);
  } catch (error) {
    logger.error({ error }, 'Failed to list LLM providers');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    logger.info(
      { tenantId, name: body.name, providerType: body.providerType, isDefault: body.isDefault },
      'Creating LLM provider'
    );

    const parsed = CreateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Create schema rejected input');
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.create(parsed.data);
    logger.info({ tenantId, providerId: provider.id }, 'Created LLM provider');
    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create LLM provider');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Provider with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
