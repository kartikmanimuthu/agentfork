import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  ReportService,
  ReportQueryService,
  ReportQueryError,
  createLogger,
} from '@chatbot/shared';
import type { ReportDb, ReportQueryDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:reports:id:run');

/**
 * Executes a SAVED report's SQL and returns its result. Read-gated (unlike the
 * ad-hoc /api/reports/run which is admin-only): the query was already authored
 * and vetted by an admin at save time, so read-only members can view it. Still
 * RLS tenant-scoped at execution.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Report', authOptions);
    if (authError) return authError;

    const report = await new ReportService(getPrismaClient() as unknown as ReportDb).getById(
      tenantId,
      id,
    );
    if (!report) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Report not found' } },
        { status: 404 },
      );
    }

    const queryService = new ReportQueryService(getPrismaClient() as unknown as ReportQueryDb);
    const result = await queryService.run(tenantId, report.sqlText);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ReportQueryError) {
      return NextResponse.json(
        { error: { type: 'query_error', message: error.message, code: error.code } },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Failed to run saved report');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
