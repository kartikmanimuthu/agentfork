import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseSearchParams, ValidationError } from '@chatbot/shared';
import { DocumentService, documentListQuerySchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:documents');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const { searchParams } = new URL(req.url);
    const query = parseSearchParams(searchParams, documentListQuerySchema);

    logger.info({ tenantId, knowledgeBaseId, sourceId: query.sourceId }, 'List documents request');

    const service = new DocumentService(tenantId);
    const result = await service.list(query.sourceId, { limit: query.limit, offset: query.offset, status: query.status });

    logger.info({ tenantId, knowledgeBaseId, sourceId: query.sourceId, count: result.items.length }, 'List documents completed');
    return NextResponse.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'List documents failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
