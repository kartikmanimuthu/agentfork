import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, updatePlaygroundSessionSchema, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:playground:sessions[sessionId]');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('read', 'PlaygroundSession', authOptions);
    if (authError) return authError;

    const { id, sessionId } = await params;
    const db = getPrismaClient();

    const session = await db.playgroundSession.findFirst({
      where: { id: sessionId, tenantId, agentId: id, userId },
      include: { agentVersion: { select: { version: true, status: true } } },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to get playground session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('update', 'PlaygroundSession', authOptions);
    if (authError) return authError;

    const { id, sessionId } = await params;
    const db = getPrismaClient();

    const existing = await db.playgroundSession.findFirst({
      where: { id: sessionId, tenantId, agentId: id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updatePlaygroundSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }
    const { name, messages, configOverrides, agentVersionId } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (messages !== undefined) updateData.messages = messages;
    if (configOverrides !== undefined) updateData.configOverrides = configOverrides;
    if (agentVersionId !== undefined) updateData.agentVersionId = agentVersionId;

    const session = await db.playgroundSession.update({
      where: { id: sessionId },
      data: updateData as any,
    });

    logger.info({ tenantId, agentId: id, sessionId }, 'Playground session updated');
    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id, sessionId: (await params).sessionId }, 'Failed to update playground session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('delete', 'PlaygroundSession', authOptions);
    if (authError) return authError;

    const { id, sessionId } = await params;
    const db = getPrismaClient();

    const existing = await db.playgroundSession.findFirst({
      where: { id: sessionId, tenantId, agentId: id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    await db.playgroundSession.delete({ where: { id: sessionId } });

    logger.info({ tenantId, agentId: id, sessionId }, 'Playground session deleted');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id, sessionId: (await params).sessionId }, 'Failed to delete playground session');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
