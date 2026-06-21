import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, AnnotationQueueItemService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { annotationQueuePopulateSchema } from '@chatbot/shared';
import type { AnnotationQueueItemDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:annotation-queues:populate');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const { limit } = await parseJson(req, annotationQueuePopulateSchema);
    const service = new AnnotationQueueItemService(getPrismaClient() as unknown as AnnotationQueueItemDb);
    const result = await service.populate(tenantId, id, limit);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleError(error, 'populate annotation queue');
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
