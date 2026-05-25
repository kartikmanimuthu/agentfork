import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, SdkWidgetService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:sdk-widgets');

export async function GET(_req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    logger.info({ tenantId }, 'GET /api/v1/sdk-widgets — listing widgets');

    const authError = await authorize('read', 'SdkWidget', authOptions);
    if (authError) {
      logger.warn({ tenantId }, 'Authorization denied for SdkWidget read');
      return authError;
    }

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widgets = await service.listByTenant();
    logger.info({ tenantId, count: widgets.length }, 'Widgets listed successfully');
    return NextResponse.json(widgets);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      logger.warn('Unauthenticated request to GET /api/v1/sdk-widgets');
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      logger.warn({ message: error.message }, 'Unauthorized request to GET /api/v1/sdk-widgets');
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error }, 'Failed to list SDK widgets');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    logger.info({ tenantId }, 'POST /api/v1/sdk-widgets — creating widget');

    const authError = await authorize('create', 'SdkWidget', authOptions);
    if (authError) {
      logger.warn({ tenantId }, 'Authorization denied for SdkWidget create');
      return authError;
    }

    const body = await req.json();
    logger.info({ tenantId, payload: body }, 'Widget create payload received');

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.create(body);

    logger.info({ tenantId, widgetId: (widget as any)?.id, sdkId: (widget as any)?.sdkId }, 'SDK widget created successfully');
    return NextResponse.json(widget, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      logger.warn('Unauthenticated request to POST /api/v1/sdk-widgets');
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      logger.warn({ message: error.message }, 'Unauthorized request to POST /api/v1/sdk-widgets');
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, 'Failed to create SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
