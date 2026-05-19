import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, parseSearchParams, ValidationError } from '@chatbot/shared';
import { createDocumentChunkRepository, chunkListQuerySchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:chunks');

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const { searchParams } = new URL(req.url);
    const query = parseSearchParams(searchParams, chunkListQuerySchema);

    logger.info({ tenantId, knowledgeBaseId, documentId: query.documentId }, 'List chunks request');

    const db = getPrismaClient();
    const chunkRepo = createDocumentChunkRepository(db);
    const result = await chunkRepo.findByDocumentId(query.documentId, { limit: query.limit, offset: query.offset });

    logger.info({ tenantId, knowledgeBaseId, documentId: query.documentId, count: result.items.length }, 'List chunks completed');
    return NextResponse.json(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'List chunks failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
