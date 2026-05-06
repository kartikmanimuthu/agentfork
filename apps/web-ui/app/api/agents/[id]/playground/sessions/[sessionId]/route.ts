import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

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
    const { name, messages, configOverrides, agentVersionId } = body;

    const session = await db.playgroundSession.update({
      where: { id: sessionId },
      data: {
        ...(name !== undefined && { name }),
        ...(messages !== undefined && { messages }),
        ...(configOverrides !== undefined && { configOverrides }),
        ...(agentVersionId !== undefined && { agentVersionId: agentVersionId ?? null }),
      },
    });

    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
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

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
