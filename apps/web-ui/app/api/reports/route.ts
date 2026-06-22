import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  ReportService,
  createReportSchema,
  createLogger,
} from '@chatbot/shared';
import type { ReportDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:reports');

function service() {
  return new ReportService(getPrismaClient() as unknown as ReportDb);
}

function errorResponse(error: unknown, message: string) {
  if (error instanceof Error && error.message.includes('Unauthenticated')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  if (error instanceof Error && error.message.includes('Unauthorized')) {
    return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
  }
  logger.error({ err: error }, message);
  return NextResponse.json(
    { error: { type: 'internal_error', message: 'Internal server error' } },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Report', authOptions);
    if (authError) return authError;
    const reports = await service().listByTenant(tenantId);
    return NextResponse.json({ reports });
  } catch (error) {
    return errorResponse(error, 'Failed to list reports');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'Report', authOptions);
    if (authError) return authError;
    const userId = await getSessionUserId(authOptions);

    const raw = await req.json().catch(() => null);
    const parsed = createReportSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: 'validation_error', issues: parsed.error.issues } },
        { status: 422 },
      );
    }

    const report = await service().create(tenantId, userId, parsed.data);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create report');
  }
}
