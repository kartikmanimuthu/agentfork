import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  DashboardQueryService,
  widgetQuerySpecSchema,
  ValidationError,
  createLogger,
} from '@chatbot/shared';
import type { DashboardQueryDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:query');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = widgetQuerySpecSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }
    const rows = await new DashboardQueryService(getPrismaClient() as unknown as DashboardQueryDb).run(tenantId, parsed.data);
    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: { type: 'validation_error', issues: error.issues } }, { status: 422 });
    }
    logger.error({ err: error }, 'Dashboard query failed');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
