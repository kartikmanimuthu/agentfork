import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:versions[versionId]:publish');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { versionId } = await params;
    const db = getPrismaClient();
    const service = new AgentVersionService(db as any);

    const version = await service.publish(versionId);
    logger.info({ tenantId, versionId }, 'Agent version published');
    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, versionId: (await params).versionId }, 'Failed to publish agent version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
