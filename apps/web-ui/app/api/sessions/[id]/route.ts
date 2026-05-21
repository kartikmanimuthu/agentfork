import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/{id}
 *
 * Returns the full detail bundle for a single InferenceSession:
 *   - session header (status, channel, channelMetadata, agent, version, timestamps, end reason)
 *   - normalized messages (ordered by createdAt)
 *   - analytics row (if computed)
 *   - linked ApiKeyExecution rows (one per turn) with latency, tokens, cache-hit, webhook status
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const session = await prisma.inferenceSession.findFirst({
      where: { id, tenantId },
      include: {
        agent: { select: { id: true, name: true, type: true } },
        agentVersion: { select: { id: true, version: true, status: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        analytics: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const executions = await prisma.apiKeyExecution.findMany({
      where: { sessionId: id, tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        latencyMs: true,
        tokenUsage: true,
        cacheHit: true,
        webhookStatus: true,
        webhookDeliveredAt: true,
        startedAt: true,
        completedAt: true,
        error: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      session: {
        id: session.id,
        name: session.name,
        channel: session.channel,
        channelMetadata: session.channelMetadata,
        status: session.status,
        startedAt: session.createdAt,
        lastActivityAt: session.updatedAt,
        idleExpiresAt: session.idleExpiresAt,
        endedAt: session.endedAt,
        endReason: session.endReason,
        agent: session.agent,
        agentVersion: session.agentVersion,
      },
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokenCount: m.tokenCount,
        createdAt: m.createdAt,
      })),
      analytics: session.analytics,
      executions,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    console.error('Session detail error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
