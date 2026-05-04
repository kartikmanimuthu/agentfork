import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

export interface DataSourceRecord {
  id: string;
  knowledgeBaseId: string;
  type: string;
  config: Record<string, unknown>;
  status: string;
  lastSyncAt: Date | null;
  syncSchedule: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDataSourceRecord {
  knowledgeBaseId: string;
  type: string;
  config: Record<string, unknown>;
  syncSchedule?: string;
}

export interface UpdateDataSourceRecord {
  config?: Record<string, unknown>;
  status?: string;
  syncSchedule?: string | null;
  lastSyncAt?: Date;
  errorMessage?: string | null;
}

export interface DataSourceRepository {
  findById(id: string): Promise<DataSourceRecord | null>;
  findByKnowledgeBaseId(
    knowledgeBaseId: string,
    params?: PaginationParams
  ): Promise<PaginatedResult<DataSourceRecord>>;
  create(input: CreateDataSourceRecord): Promise<DataSourceRecord>;
  update(id: string, input: UpdateDataSourceRecord): Promise<DataSourceRecord>;
  delete(id: string): Promise<void>;
}
