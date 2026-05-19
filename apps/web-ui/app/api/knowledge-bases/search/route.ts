import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger, parseJson, ValidationError } from '@chatbot/shared';
import { RetrievalService, multiKbSearchSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:search');

/**
 * Search across multiple knowledge bases simultaneously.
 * Body: { query, knowledgeBaseIds: string[], topK?, searchMode?, ... }
 */
export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    logger.info({ tenantId }, 'Multi-KB search request');

    const body = await parseJson(req, multiKbSearchSchema);
    const { query, knowledgeBaseIds, topK = 5, searchMode, similarityThreshold, hybridAlpha } = body;

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

    logger.info({ tenantId, kbCount: knowledgeBaseIds.length, resultCount: merged.length, failedCount: failed.length }, 'Multi-KB search completed');

    return NextResponse.json({ results: merged, failed, count: merged.length });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Multi-KB search failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
