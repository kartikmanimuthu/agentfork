import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  ReportService,
  updateReportSchema,
  createLogger,
} from '@chatbot/shared';
import type { ReportDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:reports:id');

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
  if (error instanceof Error && error.message.includes('Report not found')) {
    return NextResponse.json(
      { error: { type: 'not_found', message: 'Report not found' } },
      { status: 404 },
    );
  }
  logger.error({ err: error }, message);
  return NextResponse.json(
    { error: { type: 'internal_error', message: 'Internal server error' } },
    { status: 500 },
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Report', authOptions);
    if (authError) return authError;
    const report = await service().getById(tenantId, id);
    if (!report) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Report not found' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error, 'Failed to load report');
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Report', authOptions);
    if (authError) return authError;

    const raw = await req.json().catch(() => null);
    const parsed = updateReportSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: 'validation_error', issues: parsed.error.issues } },
        { status: 422 },
      );
    }

    const report = await service().update(tenantId, id, parsed.data);
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error, 'Failed to update report');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Report', authOptions);
    if (authError) return authError;
    await service().remove(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'Failed to delete report');
  }
}
