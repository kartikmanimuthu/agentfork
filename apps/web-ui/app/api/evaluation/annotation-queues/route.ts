import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, getPrismaClient, AnnotationQueueService, createLogger, ValidationError, parseJson } from '@chatbot/shared';
import { annotationQueueCreateSchema } from '@chatbot/shared';
import type { AnnotationQueueDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:annotation-queues');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const service = new AnnotationQueueService(getPrismaClient() as unknown as AnnotationQueueDb);
    const queues = await service.list(tenantId);
    return NextResponse.json({ queues });
  } catch (error) {
    return handleError(error, 'list annotation queues');
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const body = await parseJson(req, annotationQueueCreateSchema);
    const service = new AnnotationQueueService(getPrismaClient() as unknown as AnnotationQueueDb);
    const queue = await service.create({ ...body, tenantId, createdBy: userId });
    return NextResponse.json({ queue }, { status: 201 });
  } catch (error) {
    return handleError(error, 'create annotation queue');
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
