import { PostgresKnowledgeBaseRepository } from './knowledge-base/postgres';
import { PostgresDataSourceRepository } from './data-source/postgres';
import { PostgresDocumentRepository } from './document/postgres';
import { PostgresDocumentChunkRepository } from './document-chunk/postgres';
import type { KnowledgeBaseRepository } from './knowledge-base/interface';
import type { DataSourceRepository } from './data-source/interface';
import type { DocumentRepository } from './document/interface';
import type { DocumentChunkRepository } from './document-chunk/interface';

export function createKnowledgeBaseRepository(db: any): KnowledgeBaseRepository {
  return new PostgresKnowledgeBaseRepository(db);
}

export function createDataSourceRepository(db: any): DataSourceRepository {
  return new PostgresDataSourceRepository(db);
}

export function createDocumentRepository(db: any): DocumentRepository {
  return new PostgresDocumentRepository(db);
}

export function createDocumentChunkRepository(db: any): DocumentChunkRepository {
  return new PostgresDocumentChunkRepository(db);
}

export type { KnowledgeBaseRepository, KnowledgeBaseRecord, CreateKnowledgeBaseRecord, UpdateKnowledgeBaseRecord } from './knowledge-base/interface';
export type { DataSourceRepository, DataSourceRecord, CreateDataSourceRecord, UpdateDataSourceRecord } from './data-source/interface';
export type { DocumentRepository, DocumentRecord, CreateDocumentRecord, UpdateDocumentRecord } from './document/interface';
export type { DocumentChunkRepository, DocumentChunkRecord, CreateDocumentChunkRecord, DocumentChunkWithScore } from './document-chunk/interface';
