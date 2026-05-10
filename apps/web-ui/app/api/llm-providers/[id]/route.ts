import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService, createLogger } from '@chatbot/shared';
import { UpdateLlmProviderSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:llm-providers:detail');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, providerId: id }, 'Fetching LLM provider detail');
    const service = new LlmProviderService(tenantId);
    const provider = await service.findById(id);
    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch LLM provider detail');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    logger.info({ tenantId, providerId: id, name: body.name, providerType: body.providerType }, 'Updating LLM provider');

    const parsed = UpdateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Update schema rejected input');
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.update(id, parsed.data);
    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found for update');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    logger.info({ tenantId, providerId: id }, 'Updated LLM provider');
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to update LLM provider');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Provider with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'LlmProviders', authOptions);
    if (authError) return authError;

    const { id } = await params;
    logger.info({ tenantId, providerId: id }, 'Deleting LLM provider');
    const service = new LlmProviderService(tenantId);
    const provider = await service.delete(id);
    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found for delete');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    logger.info({ tenantId, providerId: id }, 'Deleted LLM provider');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete LLM provider');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
