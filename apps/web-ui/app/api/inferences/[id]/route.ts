import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:inferences:detail');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const execution = await prisma.apiKeyExecution.findFirst({
      where: { id, tenantId },
      include: {
        agent: { select: { id: true, name: true, type: true } },
        agentVersion: { select: { id: true, version: true, status: true } },
        session: {
          select: {
            id: true,
            status: true,
            channel: true,
            channelMetadata: true,
          },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    logger.info({ tenantId, executionId: id }, 'Inference detail fetched');

    return NextResponse.json({
      execution: {
        id: execution.id,
        agentId: execution.agentId,
        agentVersionId: execution.agentVersionId,
        sessionId: execution.sessionId,
        status: execution.status,
        input: execution.input,
        output: execution.output,
        error: execution.error,
        tokenUsage: execution.tokenUsage,
        cacheHit: execution.cacheHit,
        latencyMs: execution.latencyMs,
        webhookUrl: execution.webhookUrl,
        webhookStatus: execution.webhookStatus,
        webhookDeliveredAt: execution.webhookDeliveredAt,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        createdAt: execution.createdAt,
      },
      agent: execution.agent,
      agentVersion: execution.agentVersion,
      session: execution.session ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Inference detail error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
