import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.get(id);

    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
