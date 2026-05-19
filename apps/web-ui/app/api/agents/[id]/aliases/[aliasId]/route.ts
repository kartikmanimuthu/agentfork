import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, updateAliasSchema, createLogger } from '@chatbot/shared';
import { AgentAliasService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:aliases[aliasId]');

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { aliasId } = await params;
    const body = await req.json();
    const parsed = updateAliasSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { versionId, isDefault } = parsed.data;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    const alias = await service.updateAlias(aliasId, { versionId, isDefault });
    logger.info({ tenantId, aliasId }, 'Agent alias updated');
    return NextResponse.json(alias);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, aliasId: (await params).aliasId }, 'Failed to update alias');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { aliasId } = await params;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    await service.deleteAlias(aliasId);
    logger.info({ tenantId, aliasId }, 'Agent alias deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, aliasId: (await params).aliasId }, 'Failed to delete alias');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
