import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createAliasSchema, createLogger } from '@chatbot/shared';
import { AgentAliasService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:aliases');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);
    const aliases = await service.findByAgentId(id);

    return NextResponse.json(aliases);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to list aliases');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = createAliasSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { name, versionId, isDefault } = parsed.data;
    const db = getPrismaClient();
    const service = new AgentAliasService(tenantId, db as any);

    const alias = await service.createAlias(id, name, versionId, isDefault);
    logger.info({ tenantId, agentId: id, aliasName: name }, 'Alias created');
    return NextResponse.json(alias, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Alias name already exists for this agent' }, { status: 409 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to create alias');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
