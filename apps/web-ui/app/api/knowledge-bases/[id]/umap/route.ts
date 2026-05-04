import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import {
  createDocumentChunkRepository,
  createKnowledgeBaseRepository,
  projectEmbeddingsCached,
} from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

/**
 * Returns a 2D UMAP projection of chunk embeddings for visualization.
 * Query params: limit (default 500), documentId (optional filter)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBase', authOptions);
    if (authError) return authError;

    const { id: knowledgeBaseId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 2000);

    const db = getPrismaClient();
    const kbRepo = createKnowledgeBaseRepository(db);
    const kb = await kbRepo.findById(knowledgeBaseId);
    if (!kb || kb.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Fetch chunks with embeddings via raw SQL
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown> | null;
        embedding: string | null;
        file_name: string;
      }>
    >`
      SELECT
        dc.id,
        dc.content,
        dc.metadata,
        dc.embedding::text AS embedding,
        d."fileName" AS file_name
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      JOIN data_sources ds ON ds.id = d."dataSourceId"
      WHERE ds."knowledgeBaseId" = ${knowledgeBaseId}
        AND dc.embedding IS NOT NULL
      LIMIT ${limit}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ points: [], message: 'No embeddings found' });
    }

    // Parse vector strings like "[0.1,0.2,...]"
    const items = rows.map((row) => ({
      id: row.id,
      embedding: row.embedding
        ? row.embedding.slice(1, -1).split(',').map(Number)
        : [],
      label: row.file_name,
      metadata: { ...(row.metadata ?? {}), content: row.content.slice(0, 100) },
    })).filter((item) => item.embedding.length > 0);

    const projection = await projectEmbeddingsCached(knowledgeBaseId, items);

    return NextResponse.json(projection);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('umap-js')) {
      return NextResponse.json(
        { error: 'UMAP projection requires the "umap-js" package on the server.' },
        { status: 501 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
