import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { RetrievalService, testRetrievalSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:test');

/**
 * Test retrieval with configurable parameters — useful for tuning KB settings.
 * Returns detailed scores (dense, sparse, RRF, rerank) for each result.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Test retrieval request');

    const body = await parseJson(req, testRetrievalSchema);
    const { query, topK = 5, searchMode, similarityThreshold, hybridAlpha, rerankProvider } = body;

    const service = new RetrievalService(tenantId);
    const results = await service.query(query, {
      knowledgeBaseId,
      topK,
      searchMode,
      similarityThreshold,
      hybridAlpha,
      rerankProvider,
    });

    logger.info({ tenantId, knowledgeBaseId, resultCount: results.length }, 'Test retrieval completed');

    return NextResponse.json({
      query,
      results,
      count: results.length,
      config: { topK, searchMode, similarityThreshold, hybridAlpha, rerankProvider },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Test retrieval failed');

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
