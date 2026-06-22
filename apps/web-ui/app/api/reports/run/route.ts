import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  ReportQueryService,
  ReportQueryError,
  runReportSchema,
  createLogger,
} from '@chatbot/shared';
import type { ReportQueryDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:reports:run');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    // Executing arbitrary SQL is an authoring capability — gated to create perms
    // (Owner/Admin only). Read-only roles cannot run ad-hoc queries.
    const authError = await authorize('create', 'Report', authOptions);
    if (authError) return authError;

    const raw = await req.json().catch(() => null);
    const parsed = runReportSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: 'validation_error', issues: parsed.error.issues } },
        { status: 422 },
      );
    }

    const queryService = new ReportQueryService(getPrismaClient() as unknown as ReportQueryDb);
    const result = await queryService.run(tenantId, parsed.data.sql);
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
    logger.error({ err: error }, 'Failed to run report query');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
