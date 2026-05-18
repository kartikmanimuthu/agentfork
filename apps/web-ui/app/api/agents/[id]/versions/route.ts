import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createAgentVersionSchema, createLogger } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:versions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const versions = await db.agentVersion.findMany({
      where: { agentId: id },
      orderBy: { version: 'desc' },
      include: { aliases: { select: { id: true, name: true, isDefault: true } } }
    });

    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list agent versions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = createAgentVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const db = getPrismaClient();
    const service = new AgentVersionService(db as any);
    const version = await service.create(id, parsed.data.config as any);

    logger.info({ tenantId, agentId: id, versionId: (version as { id: string }).id }, 'Agent version created via API');
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to create agent version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
