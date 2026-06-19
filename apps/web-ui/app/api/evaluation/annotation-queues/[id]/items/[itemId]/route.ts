import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, AnnotationQueueItemService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { annotationQueueItemReviewSchema } from '@chatbot/shared';
import type { AnnotationQueueItemDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:annotation-queues:items:review');

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('update', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, annotationQueueItemReviewSchema);
    const service = new AnnotationQueueItemService(getPrismaClient() as unknown as AnnotationQueueItemDb);
    const item = await service.review({ ...body, tenantId, queueId: id, itemId, reviewerUserId: userId });
    return NextResponse.json({ item });
  } catch (error) {
    return handleError(error, 'review queue item');
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
