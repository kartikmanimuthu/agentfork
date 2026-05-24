import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, SdkWidgetService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:sdk-widgets');

export async function GET(_req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'SdkWidget', authOptions);
    if (authError) return authError;

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widgets = await service.listByTenant();
    return NextResponse.json(widgets);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error }, 'Failed to list SDK widgets');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'SdkWidget', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.create(body);

    logger.info({ tenantId }, 'SDK widget created via API');
    return NextResponse.json(widget, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error }, 'Failed to create SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
