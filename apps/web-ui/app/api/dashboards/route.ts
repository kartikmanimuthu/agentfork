import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  DashboardService,
  createDashboardSchema,
  createLogger,
} from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards');

function service() {
  return new DashboardService(getPrismaClient() as unknown as DashboardDb);
}

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const dashboards = await service().listByTenant(tenantId);
    return NextResponse.json({ dashboards });
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
    logger.error({ err: error }, 'Failed to list dashboards');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'Dashboard', authOptions);
    if (authError) return authError;
    const userId = await getSessionUserId(authOptions);

    const raw = await req.json().catch(() => null);
    const parsed = createDashboardSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    }

    const dashboard = await service().create(tenantId, userId, parsed.data);
    return NextResponse.json({ dashboard }, { status: 201 });
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
    logger.error({ err: error }, 'Failed to create dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
