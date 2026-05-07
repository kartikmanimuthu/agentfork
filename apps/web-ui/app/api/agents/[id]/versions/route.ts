import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { config } = await req.json();
    const db = getPrismaClient();
    const service = new AgentVersionService(db as any);
    const version = await service.create(id, config);

    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
