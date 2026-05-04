import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { createDocumentChunkRepository } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('documentId');
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    if (!documentId) {
      return NextResponse.json({ error: 'documentId query param is required' }, { status: 400 });
    }

    const db = getPrismaClient();
    const chunkRepo = createDocumentChunkRepository(db);
    const result = await chunkRepo.findByDocumentId(documentId, { limit, offset });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
