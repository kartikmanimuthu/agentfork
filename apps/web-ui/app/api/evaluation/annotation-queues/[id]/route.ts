import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, AnnotationQueueService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { annotationQueueUpdateSchema } from '@chatbot/shared';
import type { AnnotationQueueDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:annotation-queues:id');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const service = new AnnotationQueueService(getPrismaClient() as unknown as AnnotationQueueDb);
    const queue = await service.get(tenantId, id);
    if (!queue) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ queue });
  } catch (error) {
    return handleError(error, 'get annotation queue');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, annotationQueueUpdateSchema);
    const service = new AnnotationQueueService(getPrismaClient() as unknown as AnnotationQueueDb);
    const queue = await service.update(tenantId, id, body);
    return NextResponse.json({ queue });
  } catch (error) {
    return handleError(error, 'update annotation queue');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const service = new AnnotationQueueService(getPrismaClient() as unknown as AnnotationQueueDb);
    await service.disable(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, 'disable annotation queue');
  }
}

function handleError(error: unknown, action: string): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  }
  if (error instanceof Error && error.message.includes('Unauthenticated')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  logger.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
