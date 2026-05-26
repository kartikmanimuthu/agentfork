import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, SdkWidgetService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:sdk-widgets:detail');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const { id } = await params;
    logger.info({ tenantId, widgetId: id }, 'GET /api/v1/sdk-widgets/:id');

    const authError = await authorize('read', 'SdkWidget', authOptions);
    if (authError) {
      logger.warn({ tenantId, widgetId: id }, 'Authorization denied for SdkWidget read');
      return authError;
    }

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.findById(id);

    if (!widget) {
      logger.warn({ tenantId, widgetId: id }, 'Widget not found');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    logger.info({ tenantId, widgetId: id }, 'Widget fetched successfully');
    return NextResponse.json(widget);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error }, 'Failed to get SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const { id } = await params;
    logger.info({ tenantId, widgetId: id }, 'PATCH /api/v1/sdk-widgets/:id — updating widget');

    const authError = await authorize('update', 'SdkWidget', authOptions);
    if (authError) {
      logger.warn({ tenantId, widgetId: id }, 'Authorization denied for SdkWidget update');
      return authError;
    }

    const body = await req.json();
    logger.info({ tenantId, widgetId: id, payload: body }, 'Widget update payload received');

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.update(id, body);

    logger.info({ tenantId, widgetId: id, updatedFields: Object.keys(body) }, 'SDK widget updated successfully');
    return NextResponse.json(widget);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, 'Failed to update SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const { id } = await params;
    logger.info({ tenantId, widgetId: id }, 'DELETE /api/v1/sdk-widgets/:id');

    const authError = await authorize('delete', 'SdkWidget', authOptions);
    if (authError) {
      logger.warn({ tenantId, widgetId: id }, 'Authorization denied for SdkWidget delete');
      return authError;
    }

    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    await service.delete(id);

    logger.info({ tenantId, widgetId: id }, 'SDK widget deleted successfully');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error: (error as Error).message, stack: (error as Error).stack }, 'Failed to delete SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
