import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DocumentChunkRepository,
  DocumentChunkRecord,
  CreateDocumentChunkRecord,
  DocumentChunkWithScore,
} from './interface';

export class PostgresDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentChunkRecord | null> {
    return this.db.documentChunk.findUnique({ where: { id } });
  }

  async findByDocumentId(
    documentId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<DocumentChunkRecord>> {
    const { limit = 100, offset = 0 } = params;
    const where = { documentId };
    const [items, total] = await Promise.all([
      this.db.documentChunk.findMany({
        where,
        orderBy: { chunkIndex: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.db.documentChunk.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async createMany(chunks: CreateDocumentChunkRecord[]): Promise<number> {
    const result = await this.db.documentChunk.createMany({ data: chunks });
    return result.count;
  }

  async deleteByDocumentId(documentId: string): Promise<number> {
    const result = await this.db.documentChunk.deleteMany({ where: { documentId } });
    return result.count;
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const vector = `[${embedding.join(',')}]`;
    await this.db.$executeRaw`
      UPDATE document_chunks
      SET embedding = ${vector}::vector
      WHERE id = ${id}
    `;
  }

  async updateEmbeddingBatch(updates: Array<{ id: string; embedding: number[] }>): Promise<void> {
    await Promise.all(updates.map(({ id, embedding }) => this.updateEmbedding(id, embedding)));
  }

  async searchByVector(
    knowledgeBaseId: string,
    embedding: number[],
    topK: number,
    threshold: number
  ): Promise<DocumentChunkWithScore[]> {
    const vector = `[${embedding.join(',')}]`;
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        token_count: number;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        score: number;
        file_name: string;
      }>
    >`
      SELECT
        dc.id,
        dc."documentId" AS document_id,
        dc."chunkIndex" AS chunk_index,
        dc.content,
        dc."tokenCount" AS token_count,
        dc.metadata,
        dc."createdAt" AS created_at,
        1 - (dc.embedding <=> ${vector}::vector) AS score,
        d."fileName" AS file_name
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      JOIN data_sources ds ON ds.id = d."dataSourceId"
      WHERE ds."knowledgeBaseId" = ${knowledgeBaseId}
        AND dc.embedding IS NOT NULL
        AND 1 - (dc.embedding <=> ${vector}::vector) >= ${threshold}
      ORDER BY dc.embedding <=> ${vector}::vector
      LIMIT ${topK}
    `;

    return rows.map((row: {
      id: string;
      document_id: string;
      chunk_index: number;
      content: string;
      token_count: number;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      score: number;
      file_name: string;
    }) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      metadata: row.metadata,
      createdAt: row.created_at,
      score: Number(row.score),
      documentName: row.file_name,
    }));
  }

  async searchByText(
    knowledgeBaseId: string,
    query: string,
    topK: number
  ): Promise<DocumentChunkWithScore[]> {
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        token_count: number;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        score: number;
        file_name: string;
      }>
    >`
      SELECT
        dc.id,
        dc."documentId" AS document_id,
        dc."chunkIndex" AS chunk_index,
        dc.content,
        dc."tokenCount" AS token_count,
        dc.metadata,
        dc."createdAt" AS created_at,
        ts_rank(dc.search_text, plainto_tsquery('english', ${query})) AS score,
        d."fileName" AS file_name
      FROM document_chunks dc
      JOIN documents d ON d.id = dc."documentId"
      JOIN data_sources ds ON ds.id = d."dataSourceId"
      WHERE ds."knowledgeBaseId" = ${knowledgeBaseId}
        AND dc.search_text @@ plainto_tsquery('english', ${query})
      ORDER BY score DESC
      LIMIT ${topK}
    `;

    return rows.map((row: {
      id: string;
      document_id: string;
      chunk_index: number;
      content: string;
      token_count: number;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      score: number;
      file_name: string;
    }) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      metadata: row.metadata,
      createdAt: row.created_at,
      score: Number(row.score),
      documentName: row.file_name,
    }));
  }
}
