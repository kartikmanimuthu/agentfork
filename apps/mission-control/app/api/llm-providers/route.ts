import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { LlmProviderService, CreateLlmProviderSchema, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:llm-providers');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;
    const service = new LlmProviderService(tenantId);
    const providers = await service.list();
    logger.info({ tenantId, count: providers.length }, 'Listed LLM providers');
    return NextResponse.json(providers);
  } catch (error) {
    logger.error({ error }, 'Failed to list LLM providers');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;
    const body = await req.json().catch(() => ({}));
    logger.info(
      { tenantId, name: body.name, providerType: body.providerType, isDefault: body.isDefault },
      'Creating LLM provider',
    );

    const parsed = CreateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Create schema rejected input');
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.create(parsed.data);
    logger.info({ tenantId, providerId: provider.id }, 'Created LLM provider');
    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create LLM provider');
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Provider with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
