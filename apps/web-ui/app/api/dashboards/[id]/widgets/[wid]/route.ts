import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DashboardService,
  updateWidgetSchema,
  createLogger,
} from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:widget');
const service = () => new DashboardService(getPrismaClient() as unknown as DashboardDb);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  try {
    const { wid } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = updateWidgetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }
    const widget = await service().updateWidget(tenantId, wid, parsed.data);
    return NextResponse.json({ widget });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    }
    logger.error({ err: error }, 'Failed to update widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  try {
    const { wid } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    await service().removeWidget(tenantId, wid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    }
    logger.error({ err: error }, 'Failed to remove widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
