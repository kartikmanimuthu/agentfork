import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions
 *
 * Tenant-scoped list of InferenceSession rows joined with Agent, AgentVersion, and the
 * latest SessionAnalytics. Powers the /sessions dashboard page.
 *
 * Query params:
 *   - channel       — exact match (e.g. "API")
 *   - status        — "active" | "ended"
 *   - sentiment     — POSITIVE | NEGATIVE | NEUTRAL | MIXED
 *   - resolvedStatus — "resolved" | "unresolved"
 *   - agentId       — exact match
 *   - fromDate / toDate — ISO date range over createdAt
 *   - search        — fuzzy match on id or name
 *   - page          — 1-based, default 1
 *   - limit         — default 20, max 100
 */
export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const channel = searchParams.get('channel');
    const status = searchParams.get('status');
    const sentiment = searchParams.get('sentiment');
    const resolvedStatus = searchParams.get('resolvedStatus');
    const agentId = searchParams.get('agentId');
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));

    const where: Record<string, unknown> = { tenantId };

    if (channel && channel !== 'all') where.channel = channel;
    if (status && status !== 'all') where.status = status;
    if (agentId && agentId !== 'all') where.agentId = agentId;

    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.gte = new Date(fromDate);
      if (toDate) range.lte = new Date(`${toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const analyticsFilter: Record<string, unknown> = {};
    if (sentiment && sentiment !== 'all') analyticsFilter.sentiment = sentiment;
    if (resolvedStatus === 'resolved') analyticsFilter.isResolved = true;
    else if (resolvedStatus === 'unresolved') analyticsFilter.isResolved = false;
    if (Object.keys(analyticsFilter).length > 0) {
      where.analytics = analyticsFilter;
    }

    const prisma = getPrismaClient();
    const [rows, total] = await Promise.all([
      prisma.inferenceSession.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, type: true } },
          agentVersion: { select: { id: true, version: true, status: true } },
          analytics: {
            select: {
              sentiment: true,
              isResolved: true,
              confidenceScore: true,
              firstUserQuery: true,
              summary: true,
            },
          },
          _count: { select: { messages: true, executions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inferenceSession.count({ where }),
    ]);

    // Compute average latency per session from its executions (lightweight aggregate).
    const sessionIds = rows.map((r) => r.id);
    const latencyAgg = sessionIds.length
      ? await prisma.apiKeyExecution.groupBy({
          by: ['sessionId'],
          where: { sessionId: { in: sessionIds } },
          _avg: { latencyMs: true },
        })
      : [];
    const latencyMap = new Map<string, number | null>(
      latencyAgg
        .filter((a): a is typeof a & { sessionId: string } => a.sessionId !== null)
        .map((a) => [a.sessionId, a._avg.latencyMs ?? null]),
    );

    const sessions = rows.map((s) => ({
      id: s.id,
      name: s.name,
      channel: s.channel,
      channelMetadata: s.channelMetadata,
      status: s.status,
      startedAt: s.createdAt,
      lastActivityAt: s.updatedAt,
      idleExpiresAt: s.idleExpiresAt,
      endedAt: s.endedAt,
      endReason: s.endReason,
      messageCount: s._count.messages,
      executionCount: s._count.executions,
      avgLatencyMs: latencyMap.get(s.id) ?? null,
      agent: s.agent,
      agentVersion: s.agentVersion,
      analytics: s.analytics,
    }));

    return NextResponse.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    console.error('Sessions list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
