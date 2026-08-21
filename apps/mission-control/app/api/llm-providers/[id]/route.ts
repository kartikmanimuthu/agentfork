import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { LlmProviderService, UpdateLlmProviderSchema, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:llm-providers:detail');

async function requireTenantId() {
  const session = await getServerSession(authOptions);
  return session?.studio?.tenantId ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await requireTenantId();
    if (!tenantId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
    // Opt-in, and only the edit form asks. The detail VIEW and the provider list
    // render fine without secrets, and shipping decrypted credentials to every
    // page that happens to read a provider would widen the exposure for no reason.
    const includeSecrets = new URL(req.url).searchParams.get('withSecrets') === '1';
    const service = new LlmProviderService(tenantId);
    const provider = await service.findById(id, { includeSecrets });
    if (!provider) {
      logger.warn({ tenantId, providerId: id }, 'Provider not found');
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    return NextResponse.json(provider);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch LLM provider detail');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await requireTenantId();
    if (!tenantId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    logger.info({ tenantId, providerId: id, name: body.name, providerType: body.providerType }, 'Updating LLM provider');

    const parsed = UpdateLlmProviderSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Update schema rejected input');
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
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
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Provider with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await requireTenantId();
    if (!tenantId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await params;
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
