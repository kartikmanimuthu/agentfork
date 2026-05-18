import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, createPlaygroundSessionSchema, createLogger } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:playground:sessions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('read', 'PlaygroundSession', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const agent = await service.findById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const sessions = await db.playgroundSession.findMany({
      where: { tenantId, agentId: id, userId },
      include: { agentVersion: { select: { version: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list playground sessions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'PlaygroundSession', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new AgentService(tenantId, db as any);
    const agent = await service.findById(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await req.json();
    const parsed = createPlaygroundSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { name, messages, configOverrides, agentVersionId } = parsed.data;

    const session = await db.playgroundSession.create({
      data: {
        tenantId,
        userId,
        agentId: id,
        agentVersionId: agentVersionId ?? null,
        name: name || 'Untitled Session',
        messages: messages ?? [],
        configOverrides: (configOverrides ?? {}) as any,
      },
    });

    logger.info({ tenantId, agentId: id, sessionId: session.id }, 'Playground session created');
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to create playground session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
