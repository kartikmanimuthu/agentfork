import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

export interface DocumentChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateDocumentChunkRecord {
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentChunkWithScore extends DocumentChunkRecord {
  score: number;
  documentName?: string;
}

export interface DocumentChunkRepository {
  findById(id: string): Promise<DocumentChunkRecord | null>;
  findByDocumentId(
    documentId: string,
    params?: PaginationParams
  ): Promise<PaginatedResult<DocumentChunkRecord>>;
  createMany(chunks: CreateDocumentChunkRecord[]): Promise<number>;
  deleteByDocumentId(documentId: string): Promise<number>;
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
  updateEmbeddingBatch(updates: Array<{ id: string; embedding: number[] }>): Promise<void>;
  searchByVector(
    knowledgeBaseId: string,
    embedding: number[],
    topK: number,
    threshold: number
  ): Promise<DocumentChunkWithScore[]>;
  searchByText(
    knowledgeBaseId: string,
    query: string,
    topK: number
  ): Promise<DocumentChunkWithScore[]>;
}
