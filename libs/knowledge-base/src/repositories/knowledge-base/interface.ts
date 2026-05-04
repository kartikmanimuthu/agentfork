import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type {
  KnowledgeBaseStatus,
  PreProcessingConfig,
  RetrievalConfig,
} from '../../types';

export interface KnowledgeBaseRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
  preProcessing: PreProcessingConfig;
  retrievalConfig: RetrievalConfig;
  status: string;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeBaseRecord {
  tenantId: string;
  name: string;
  description?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  chunkStrategy?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  preProcessing?: PreProcessingConfig;
  retrievalConfig?: RetrievalConfig;
}

export interface UpdateKnowledgeBaseRecord {
  name?: string;
  description?: string;
  chunkStrategy?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  preProcessing?: PreProcessingConfig;
  retrievalConfig?: RetrievalConfig;
  status?: KnowledgeBaseStatus;
  documentCount?: number;
  chunkCount?: number;
}

export interface KnowledgeBaseRepository {
  findById(id: string): Promise<KnowledgeBaseRecord | null>;
  findByTenantId(
    tenantId: string,
    params?: PaginationParams & { status?: string }
  ): Promise<PaginatedResult<KnowledgeBaseRecord>>;
  create(input: CreateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord>;
  update(id: string, input: UpdateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord>;
  delete(id: string): Promise<void>;
  incrementCounts(id: string, documentDelta: number, chunkDelta: number): Promise<void>;
}
