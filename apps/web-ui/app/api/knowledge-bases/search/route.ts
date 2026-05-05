import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { RetrievalService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

/**
 * Search across multiple knowledge bases simultaneously.
 * Body: { query, knowledgeBaseIds: string[], topK?, searchMode?, ... }
 */
export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const { query, knowledgeBaseIds, topK = 5, searchMode, similarityThreshold, hybridAlpha } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    if (!Array.isArray(knowledgeBaseIds) || knowledgeBaseIds.length === 0) {
      return NextResponse.json({ error: 'knowledgeBaseIds must be a non-empty array' }, { status: 400 });
    }

    const service = new RetrievalService(tenantId);

    const allResults = await Promise.allSettled(
      knowledgeBaseIds.map((kbId: string) =>
        service.query(query, {
          knowledgeBaseId: kbId,
          topK,
          searchMode,
          similarityThreshold,
          hybridAlpha,
        }).then((results) => ({ knowledgeBaseId: kbId, results }))
      )
    );

    type KbResult = { knowledgeBaseId: string; results: Array<{ score: number }> };
    const successful: KbResult[] = [];
    const failed: Array<{ knowledgeBaseId: string; error: string }> = [];

    allResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        successful.push(r.value as KbResult);
      } else {
        failed.push({ knowledgeBaseId: knowledgeBaseIds[i], error: (r.reason as Error)?.message ?? 'Unknown error' });
      }
    });

    // Merge and re-rank by score
    const merged = successful
      .flatMap(({ knowledgeBaseId, results }) =>
        (results as Array<{ score: number }>).map((r) => ({ ...r, knowledgeBaseId }))
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * knowledgeBaseIds.length);

    return NextResponse.json({ results: merged, failed, count: merged.length });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
