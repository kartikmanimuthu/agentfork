import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:versions[versionId]');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AgentVersion', authOptions);
    if (authError) return authError;

    const { versionId } = await params;
    const db = getPrismaClient();
    const service = new AgentVersionService(db as any);
    const version = await service.findById(versionId);

    if (!version) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, versionId: (await params).versionId }, 'Failed to get agent version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
