import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DashboardService,
  updateDashboardSchema,
  createLogger,
} from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:id');
const service = () => new DashboardService(getPrismaClient() as unknown as DashboardDb);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const dashboard = await service().getById(tenantId, id);
    if (!dashboard) {
      return NextResponse.json({ error: { type: 'not_found', message: 'Dashboard not found' } }, { status: 404 });
    }
    return NextResponse.json({ dashboard });
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
    logger.error({ err: error }, 'Failed to load dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = updateDashboardSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }
    const dashboard = await service().update(tenantId, id, parsed.data);
    return NextResponse.json({ dashboard });
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
    logger.error({ err: error }, 'Failed to update dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Dashboard', authOptions);
    if (authError) return authError;
    await service().remove(tenantId, id);
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
    logger.error({ err: error }, 'Failed to delete dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
