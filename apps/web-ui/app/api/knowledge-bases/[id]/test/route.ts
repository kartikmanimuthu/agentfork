import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { RetrievalService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

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
    const body = await req.json();
    const { query, topK = 5, searchMode, similarityThreshold, hybridAlpha, rerankProvider } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const service = new RetrievalService(tenantId);
    const results = await service.query(query, {
      knowledgeBaseId,
      topK,
      searchMode,
      similarityThreshold,
      hybridAlpha,
      rerankProvider,
    });

    return NextResponse.json({
      query,
      results,
      count: results.length,
      config: { topK, searchMode, similarityThreshold, hybridAlpha, rerankProvider },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
