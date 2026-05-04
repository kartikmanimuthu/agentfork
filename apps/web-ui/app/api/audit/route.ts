import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:audit');

function computeStats(logs: any[]) {
  return {
    totalLogs: logs.length,
    successCount: logs.filter((log: any) => log.status === 'success').length,
    errorCount: logs.filter((log: any) => log.status === 'error').length,
    warningCount: logs.filter((log: any) => log.status === 'warning').length,
    systemEvents: logs.filter((log: any) => log.userType === 'system').length,
    userEvents: logs.filter(
      (log: any) => log.userType === 'user' || log.userType === 'admin',
    ).length,
    criticalEvents: logs.filter((log: any) => log.severity === 'critical').length,
    byEventType: logs.reduce((acc: Record<string, number>, log: any) => {
      const key = log.eventType || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    byStatus: logs.reduce((acc: Record<string, number>, log: any) => {
      const key = log.status || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    bySeverity: logs.reduce((acc: Record<string, number>, log: any) => {
      const key = log.severity || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    byResourceType: logs.reduce((acc: Record<string, number>, log: any) => {
      const key = log.metadata?.resourceType || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Settings', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const eventType = searchParams.get('eventType') ?? undefined;
    const severity = searchParams.get('severity') ?? undefined;
    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate = searchParams.get('endDate') ?? undefined;

    const prisma = getPrismaClient();

    const where: Record<string, unknown> = { tenantId };
    if (eventType) where.eventType = eventType;
    if (severity) where.severity = severity;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const stats = computeStats(items);

    return NextResponse.json({ items, total, limit, offset, stats });
  } catch (error) {
    logger.error({ error }, 'Audit API error');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
