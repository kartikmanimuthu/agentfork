import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DashboardService,
  createWidgetSchema,
  createLogger,
} from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:widgets');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = createWidgetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }
    const widget = await new DashboardService(getPrismaClient() as unknown as DashboardDb).addWidget(tenantId, id, parsed.data);
    return NextResponse.json({ widget }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    }
    logger.error({ err: error }, 'Failed to add widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
