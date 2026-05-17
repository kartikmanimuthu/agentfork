import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { DataSourceService, updateDataSourceSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:source-detail');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    logger.info({ tenantId, sourceId }, 'Get source request');

    const service = new DataSourceService(tenantId);
    const source = await service.get(sourceId);

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, sourceId }, 'Get source completed');
    return NextResponse.json(source);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Get source failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    logger.info({ tenantId, sourceId }, 'Update source request');

    const input = await parseJson(req, updateDataSourceSchema);

    const service = new DataSourceService(tenantId);
    const source = await service.update(sourceId, input);

    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, sourceId }, 'Source updated');
    return NextResponse.json(source);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Update source failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { sourceId } = await params;
    logger.info({ tenantId, sourceId }, 'Delete source request');

    const service = new DataSourceService(tenantId);
    const deleted = await service.delete(sourceId);

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, sourceId }, 'Source deleted');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Delete source failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
