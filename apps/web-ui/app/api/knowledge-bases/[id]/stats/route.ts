import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger } from '@chatbot/shared';
import { KnowledgeBaseService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:stats');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    logger.info({ tenantId, knowledgeBaseId }, 'Get KB stats request');

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.get(knowledgeBaseId);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    logger.info({ tenantId, knowledgeBaseId }, 'Get KB stats completed');
    return NextResponse.json({
      id: kb.id,
      name: kb.name,
      status: kb.status,
      documentCount: kb.documentCount,
      chunkCount: kb.chunkCount,
      embeddingProvider: kb.embeddingProvider,
      embeddingModel: kb.embeddingModel,
      embeddingDimensions: kb.embeddingDimensions,
      chunkStrategy: kb.chunkStrategy,
      chunkSize: kb.chunkSize,
      chunkOverlap: kb.chunkOverlap,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'Get KB stats failed');

    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
