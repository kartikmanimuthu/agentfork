import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, AnnotationQueueItemService, createLogger } from '@chatbot/shared';
import type { AnnotationQueueItemDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:annotation-queues:items');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'AnnotationQueue', authOptions);
    if (authError) return authError;
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? undefined;
    const limit = Number(searchParams.get('limit') ?? 50);
    const offset = Number(searchParams.get('offset') ?? 0);
    const service = new AnnotationQueueItemService(getPrismaClient() as unknown as AnnotationQueueItemDb);
    const items = await service.list(tenantId, id, { status, limit, offset });
    return NextResponse.json({ items });
  } catch (error) {
    logger.error({ err: error, action: 'list queue items' }, 'Failed to list queue items');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
