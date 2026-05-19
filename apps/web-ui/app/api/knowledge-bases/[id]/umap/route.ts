import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, parseSearchParams, ValidationError } from '@chatbot/shared';
import {
  createDocumentChunkRepository,
  createKnowledgeBaseRepository,
  projectEmbeddingsCached,
  umapQuerySchema,
} from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:knowledge-bases:umap');

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
    const query = parseSearchParams(searchParams, umapQuerySchema);

    logger.info({ tenantId, knowledgeBaseId, limit: query.limit }, 'UMAP projection request');

    const db = getPrismaClient();
    const kbRepo = createKnowledgeBaseRepository(db);
    const kb = await kbRepo.findById(knowledgeBaseId);
    if (!kb || kb.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

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
      LIMIT ${query.limit}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ points: [], message: 'No embeddings found' });
    }

    const items = rows.map((row) => ({
      id: row.id,
      embedding: row.embedding
        ? row.embedding.slice(1, -1).split(',').map(Number)
        : [],
      label: row.file_name,
      metadata: { ...(row.metadata ?? {}), content: row.content.slice(0, 100) },
    })).filter((item) => item.embedding.length > 0);

    const projection = await projectEmbeddingsCached(knowledgeBaseId, items);

    logger.info({ tenantId, knowledgeBaseId, pointCount: projection.points.length }, 'UMAP projection completed');
    return NextResponse.json(projection);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message, errorStack: err.stack }, 'UMAP projection failed');

    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err.message.includes('umap-js')) {
      return NextResponse.json(
        { error: 'UMAP projection requires the "umap-js" package on the server.' },
        { status: 501 }
      );
    }
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
