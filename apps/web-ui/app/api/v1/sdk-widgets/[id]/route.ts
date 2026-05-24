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
    const authError = await authorize('read', 'SdkWidget', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.findById(id);

    if (!widget) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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
    const authError = await authorize('update', 'SdkWidget', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    const widget = await service.update(id, body);

    logger.info({ tenantId, widgetId: id }, 'SDK widget updated via API');
    return NextResponse.json(widget);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error, widgetId: (await params).id }, 'Failed to update SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'SdkWidget', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const service = new SdkWidgetService(tenantId, db);
    await service.delete(id);

    logger.info({ tenantId, widgetId: id }, 'SDK widget deleted via API');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ error, widgetId: (await params).id }, 'Failed to delete SDK widget');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
