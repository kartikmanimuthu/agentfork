import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

export interface DocumentRecord {
  id: string;
  dataSourceId: string;
  sourceKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown> | null;
  processedText: string | null;
  status: string;
  errorMessage: string | null;
  tokenCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDocumentRecord {
  dataSourceId: string;
  sourceKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateDocumentRecord {
  status?: string;
  processedText?: string;
  errorMessage?: string | null;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentRepository {
  findById(id: string): Promise<DocumentRecord | null>;
  findByDataSourceId(
    dataSourceId: string,
    params?: PaginationParams & { status?: string }
  ): Promise<PaginatedResult<DocumentRecord>>;
  findBySourceKey(dataSourceId: string, sourceKey: string): Promise<DocumentRecord | null>;
  create(input: CreateDocumentRecord): Promise<DocumentRecord>;
  update(id: string, input: UpdateDocumentRecord): Promise<DocumentRecord>;
  delete(id: string): Promise<void>;
  deleteByDataSourceId(dataSourceId: string): Promise<number>;
}
