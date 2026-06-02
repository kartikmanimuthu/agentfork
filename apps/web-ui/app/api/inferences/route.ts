import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:inferences');

const querySchema = z.object({
  agentId: z.string().optional(),
  status: z.enum(['completed', 'failed', 'running']).optional(),
  type: z.enum(['stateful', 'stateless']).optional(),
  cacheHit: z.enum(['true', 'false']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 });
    }

    const { agentId, status, type, cacheHit, fromDate, toDate, search, page, limit } = parsed.data;

    const where: Record<string, unknown> = { tenantId };

    if (agentId) where.agentId = agentId;
    if (status) where.status = status;
    if (type === 'stateful') where.sessionId = { not: null };
    if (type === 'stateless') where.sessionId = null;
    if (cacheHit === 'true') where.cacheHit = true;
    if (cacheHit === 'false') where.cacheHit = false;
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.gte = new Date(fromDate);
      if (toDate) range.lte = new Date(`${toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }
    if (search) {
      where.id = { contains: search, mode: 'insensitive' };
    }

    const prisma = getPrismaClient();

    const [rows, total, allInWindow] = await Promise.all([
      prisma.apiKeyExecution.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, type: true } },
          agentVersion: { select: { id: true, version: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.apiKeyExecution.count({ where }),
      prisma.apiKeyExecution.findMany({
        where,
        select: { status: true, cacheHit: true, latencyMs: true },
      }),
    ]);

    const completedCount = allInWindow.filter((r) => r.status === 'completed').length;
    const cacheHitCount = allInWindow.filter((r) => r.cacheHit).length;
    const windowTotal = allInWindow.length;
    const latencyValues = allInWindow.map((r) => r.latencyMs).filter((v): v is number => v !== null);
    const avgLatencyMs = latencyValues.length > 0
      ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
      : null;

    const stats = {
      total: windowTotal,
      successRate: windowTotal > 0 ? completedCount / windowTotal : 0,
      avgLatencyMs,
      cacheHitRate: windowTotal > 0 ? cacheHitCount / windowTotal : 0,
    };

    const executions = rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentVersionId: r.agentVersionId,
      sessionId: r.sessionId,
      status: r.status,
      latencyMs: r.latencyMs,
      tokenUsage: r.tokenUsage,
      cacheHit: r.cacheHit,
      webhookStatus: r.webhookStatus,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      agent: r.agent,
      agentVersion: r.agentVersion,
    }));

    logger.info({ tenantId, total, page }, 'Inferences list fetched');

    return NextResponse.json({
      stats,
      executions,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Inferences list error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
