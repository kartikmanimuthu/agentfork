import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DashboardService,
  saveLayoutSchema,
  createLogger,
} from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:layout');

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = saveLayoutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }
    await new DashboardService(getPrismaClient() as unknown as DashboardDb).saveLayout(tenantId, id, parsed.data.layouts);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to save layout');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
