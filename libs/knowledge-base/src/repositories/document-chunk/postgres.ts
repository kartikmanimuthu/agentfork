import { createLogger } from '@chatbot/shared/workers';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  DocumentChunkRepository,
  DocumentChunkRecord,
  CreateDocumentChunkRecord,
  DocumentChunkWithScore,
} from './interface';

const repoLogger = createLogger('kb:repo:document-chunk');

export class PostgresDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentChunkRecord | null> {
    try {
      return await this.db.documentChunk.findUnique({ where: { id } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, errorMessage: error.message, errorStack: error.stack }, 'Failed to find document chunk by id');
      throw error;
    }
  }

  async findByDocumentId(
    documentId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<DocumentChunkRecord>> {
    const { limit = 100, offset = 0 } = params;
    const where = { documentId };
    try {
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
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ documentId, params, errorMessage: error.message, errorStack: error.stack }, 'Failed to find document chunks by document');
      throw error;
    }
  }

  async createMany(chunks: CreateDocumentChunkRecord[]): Promise<number> {
    try {
      const result = await this.db.documentChunk.createMany({ data: chunks });
      return result.count;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ chunkCount: chunks.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to create document chunks');
      throw error;
    }
  }

  async deleteByDocumentId(documentId: string): Promise<number> {
    try {
      const result = await this.db.documentChunk.deleteMany({ where: { documentId } });
      return result.count;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ documentId, errorMessage: error.message, errorStack: error.stack }, 'Failed to delete document chunks by document');
      throw error;
    }
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const vector = `[${embedding.join(',')}]`;
    try {
      await this.db.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
        vector,
        id
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ id, embeddingDimensions: embedding.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to update embedding');
      throw error;
    }
  }

  async updateEmbeddingBatch(updates: Array<{ id: string; embedding: number[] }>): Promise<void> {
    try {
      await Promise.all(updates.map(({ id, embedding }) => this.updateEmbedding(id, embedding)));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ batchSize: updates.length, errorMessage: error.message, errorStack: error.stack }, 'Failed to update embedding batch');
      throw error;
    }
  }

  async searchByVector(
    knowledgeBaseId: string,
    embedding: number[],
    topK: number,
    threshold: number
  ): Promise<DocumentChunkWithScore[]> {
    const vector = `[${embedding.join(',')}]`;
    try {
      const rows: Array<{
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        token_count: number;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        score: number;
        file_name: string;
      }> = await this.db.$queryRaw`
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

      return rows.map((row) => ({
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
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ knowledgeBaseId, topK, threshold, errorMessage: error.message, errorStack: error.stack }, 'Failed vector search');
      throw error;
    }
  }

  async searchByText(
    knowledgeBaseId: string,
    query: string,
    topK: number
  ): Promise<DocumentChunkWithScore[]> {
    repoLogger.debug({ knowledgeBaseId, query, topK }, 'Executing text search');
    try {
      const rows: Array<{
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        token_count: number;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        score: number;
        file_name: string;
      }> = await this.db.$queryRawUnsafe(
        `SELECT
          dc.id,
          dc."documentId" AS document_id,
          dc."chunkIndex" AS chunk_index,
          dc.content,
          dc."tokenCount" AS token_count,
          dc.metadata,
          dc."createdAt" AS created_at,
          ts_rank(dc."searchText", plainto_tsquery('english', $1)) AS score,
          d."fileName" AS file_name
        FROM document_chunks dc
        JOIN documents d ON d.id = dc."documentId"
        JOIN data_sources ds ON ds.id = d."dataSourceId"
        WHERE ds."knowledgeBaseId" = $2
          AND dc."searchText" @@ plainto_tsquery('english', $1)
        ORDER BY score DESC
        LIMIT $3`,
        query,
        knowledgeBaseId,
        topK
      );

      repoLogger.debug({ knowledgeBaseId, resultCount: rows.length }, 'Text search completed');

      return rows.map((row) => ({
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
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      repoLogger.error({ knowledgeBaseId, query, topK, errorMessage: error.message, errorStack: error.stack }, 'Failed text search');
      throw error;
    }
  }
}
