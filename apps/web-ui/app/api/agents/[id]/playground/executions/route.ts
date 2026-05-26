import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:playground:executions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('read', 'AgentExecution', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const executions = await db.agentExecution.findMany({
      where: { tenantId, agentId: id, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        agentVersion: { select: { version: true, status: true } },
      },
    });

    return NextResponse.json(executions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, agentId: (await params).id }, 'Failed to list executions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
