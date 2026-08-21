import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:transcription:jobs');

const querySchema = z.object({
  status: z.enum(['completed', 'failed', 'running', 'pending']).optional(),
  source: z.enum(['payload', 's3']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJob', authOptions);
    if (authError) return authError;

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 });
    }
    const { status, source, fromDate, toDate, search, page, limit } = parsed.data;

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;
    if (source) where.source = source;
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.gte = new Date(fromDate);
      if (toDate) range.lte = new Date(`${toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }
    if (search) where.id = { contains: search, mode: 'insensitive' };

    const prisma = getPrismaClient();
    const [rows, total, allInWindow] = await Promise.all([
      prisma.transcriptionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, source: true, status: true, fileName: true, mimeType: true,
          durationSec: true, latencyMs: true, language: true, webhookStatus: true,
          createdAt: true, completedAt: true,
        },
      }),
      prisma.transcriptionJob.count({ where }),
      prisma.transcriptionJob.findMany({ where, select: { status: true, latencyMs: true, durationSec: true } }),
    ]);

    const windowTotal = allInWindow.length;
    const completedCount = allInWindow.filter((r) => r.status === 'completed').length;
    const latencyValues = allInWindow.map((r) => r.latencyMs).filter((v): v is number => v !== null);
    const avgLatencyMs = latencyValues.length > 0
      ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
      : null;
    const totalMinutes = allInWindow.reduce((a, r) => a + (r.durationSec ?? 0), 0) / 60;

    const stats = {
      total: windowTotal,
      successRate: windowTotal > 0 ? completedCount / windowTotal : 0,
      avgLatencyMs,
      totalMinutes,
    };

    logger.info({ tenantId, total, page }, 'Transcription jobs list fetched');
    return NextResponse.json({
      stats,
      jobs: rows,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Transcription jobs list error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
