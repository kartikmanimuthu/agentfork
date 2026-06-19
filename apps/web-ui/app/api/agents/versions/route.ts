import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents:versions');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AgentVersion', authOptions);
    if (authError) return authError;

    const db = getPrismaClient();
    const versions = await db.agentVersion.findMany({
      where: { agent: { tenantId } },
      orderBy: [{ agentId: 'asc' }, { version: 'desc' }],
      include: { agent: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list agent versions');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
