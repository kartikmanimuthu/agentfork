import { getPrismaClient } from '@chatbot/shared/workers';
import { S3Service } from '@chatbot/shared';
import { createLogger } from '@chatbot/shared/workers';
import {
  createKnowledgeBaseRepository,
  createDataSourceRepository,
  createDocumentRepository,
  createDocumentChunkRepository,
} from '../repositories/index';
import type {
  KnowledgeBaseRecord,
  CreateKnowledgeBaseRecord,
  UpdateKnowledgeBaseRecord,
  DataSourceRecord,
  CreateDataSourceRecord,
  UpdateDataSourceRecord,
  DocumentRecord,
  CreateDocumentRecord,
  UpdateDocumentRecord,
} from '../repositories/index';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

// ─── KnowledgeBaseService ─────────────────────────────────────────────────────

const kbLogger = createLogger('kb:knowledge-base-service');

export class KnowledgeBaseService {
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.kbRepo = createKnowledgeBaseRepository(db);
  }

  async list(
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<KnowledgeBaseRecord>> {
    kbLogger.info({ tenantId: this.tenantId, params }, 'Listing knowledge bases');
    try {
      const result = await this.kbRepo.findByTenantId(this.tenantId, params);
      kbLogger.info({ tenantId: this.tenantId, count: result.total }, 'Listed knowledge bases');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      kbLogger.error(
        { tenantId: this.tenantId, params, errorMessage: error.message, errorStack: error.stack },
        'Failed to list knowledge bases'
      );
      throw error;
    }
  }

  async get(id: string): Promise<KnowledgeBaseRecord | null> {
    kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Fetching knowledge base');
    try {
      const kb = await this.kbRepo.findById(id);
      if (!kb || kb.tenantId !== this.tenantId) {
        kbLogger.warn({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Knowledge base not found');
        return null;
      }
      kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Fetched knowledge base');
      return kb;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      kbLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId: id, errorMessage: error.message, errorStack: error.stack },
        'Failed to fetch knowledge base'
      );
      throw error;
    }
  }

  async create(input: Omit<CreateKnowledgeBaseRecord, 'tenantId'>): Promise<KnowledgeBaseRecord> {
    kbLogger.info({ tenantId: this.tenantId, input }, 'Creating knowledge base');
    try {
      const kb = await this.kbRepo.create({ ...input, tenantId: this.tenantId });
      kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: kb.id }, 'Created knowledge base');
      return kb;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      kbLogger.error(
        { tenantId: this.tenantId, input, errorMessage: error.message, errorStack: error.stack },
        'Failed to create knowledge base'
      );
      throw error;
    }
  }

  async update(id: string, input: UpdateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord | null> {
    kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id, input }, 'Updating knowledge base');
    try {
      const existing = await this.get(id);
      if (!existing) {
        kbLogger.warn({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Knowledge base not found for update');
        return null;
      }
      const kb = await this.kbRepo.update(id, input);
      kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Updated knowledge base');
      return kb;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      kbLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId: id, input, errorMessage: error.message, errorStack: error.stack },
        'Failed to update knowledge base'
      );
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Deleting knowledge base');
    try {
      const existing = await this.get(id);
      if (!existing) {
        kbLogger.warn({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Knowledge base not found for delete');
        return false;
      }
      await this.kbRepo.delete(id);
      kbLogger.info({ tenantId: this.tenantId, knowledgeBaseId: id }, 'Deleted knowledge base');
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      kbLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId: id, errorMessage: error.message, errorStack: error.stack },
        'Failed to delete knowledge base'
      );
      throw error;
    }
  }
}

// ─── DataSourceService ────────────────────────────────────────────────────────

const dsLogger = createLogger('kb:data-source-service');

export class DataSourceService {
  private readonly dsRepo: ReturnType<typeof createDataSourceRepository>;
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.dsRepo = createDataSourceRepository(db);
    this.kbRepo = createKnowledgeBaseRepository(db);
  }

  private async assertKbOwnership(knowledgeBaseId: string): Promise<void> {
    const kb = await this.kbRepo.findById(knowledgeBaseId);
    if (!kb || kb.tenantId !== this.tenantId) {
      throw new Error(`KnowledgeBase ${knowledgeBaseId} not found`);
    }
  }

  async list(
    knowledgeBaseId: string,
    params?: PaginationParams
  ): Promise<PaginatedResult<DataSourceRecord>> {
    dsLogger.info({ tenantId: this.tenantId, knowledgeBaseId, params }, 'Listing data sources');
    try {
      await this.assertKbOwnership(knowledgeBaseId);
      const result = await this.dsRepo.findByKnowledgeBaseId(knowledgeBaseId, params);
      dsLogger.info({ tenantId: this.tenantId, knowledgeBaseId, count: result.total }, 'Listed data sources');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dsLogger.error(
        { tenantId: this.tenantId, knowledgeBaseId, params, errorMessage: error.message, errorStack: error.stack },
        'Failed to list data sources'
      );
      throw error;
    }
  }

  async get(id: string): Promise<DataSourceRecord | null> {
    dsLogger.info({ tenantId: this.tenantId, dataSourceId: id }, 'Fetching data source');
    try {
      const ds = await this.dsRepo.findById(id);
      if (!ds) {
        dsLogger.warn({ tenantId: this.tenantId, dataSourceId: id }, 'Data source not found');
        return null;
      }
      await this.assertKbOwnership(ds.knowledgeBaseId);
      dsLogger.info({ tenantId: this.tenantId, dataSourceId: id }, 'Fetched data source');
      return ds;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dsLogger.error(
        { tenantId: this.tenantId, dataSourceId: id, errorMessage: error.message, errorStack: error.stack },
        'Failed to fetch data source'
      );
      throw error;
    }
  }

  async create(input: CreateDataSourceRecord): Promise<DataSourceRecord> {
    dsLogger.info({ tenantId: this.tenantId, knowledgeBaseId: input.knowledgeBaseId, type: input.type }, 'Creating data source');
    try {
      await this.assertKbOwnership(input.knowledgeBaseId);
      const ds = await this.dsRepo.create(input);
      dsLogger.info({ tenantId: this.tenantId, dataSourceId: ds.id }, 'Created data source');
      return ds;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dsLogger.error(
        { tenantId: this.tenantId, input, errorMessage: error.message, errorStack: error.stack },
        'Failed to create data source'
      );
      throw error;
    }
  }

  async update(id: string, input: UpdateDataSourceRecord): Promise<DataSourceRecord | null> {
    dsLogger.info({ tenantId: this.tenantId, dataSourceId: id, input }, 'Updating data source');
    try {
      const existing = await this.get(id);
      if (!existing) {
        dsLogger.warn({ tenantId: this.tenantId, dataSourceId: id }, 'Data source not found for update');
        return null;
      }
      const ds = await this.dsRepo.update(id, input);
      dsLogger.info({ tenantId: this.tenantId, dataSourceId: id }, 'Updated data source');
      return ds;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dsLogger.error(
        { tenantId: this.tenantId, dataSourceId: id, input, errorMessage: error.message, errorStack: error.stack },
        'Failed to update data source'
      );
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    dsLogger.info({ tenantId: this.tenantId, dataSourceId: id }, 'Deleting data source');
    try {
      const existing = await this.get(id);
      if (!existing) {
        dsLogger.warn({ tenantId: this.tenantId, dataSourceId: id }, 'Data source not found for delete');
        return false;
      }
      await this.dsRepo.delete(id);
      dsLogger.info({ tenantId: this.tenantId, dataSourceId: id }, 'Deleted data source');
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dsLogger.error(
        { tenantId: this.tenantId, dataSourceId: id, errorMessage: error.message, errorStack: error.stack },
        'Failed to delete data source'
      );
      throw error;
    }
  }
}

// ─── DocumentService ──────────────────────────────────────────────────────────

const docLogger = createLogger('kb:document-service');

export class DocumentService {
  private readonly docRepo: ReturnType<typeof createDocumentRepository>;
  private readonly dsRepo: ReturnType<typeof createDataSourceRepository>;
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;
  private readonly s3 = new S3Service();

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.docRepo = createDocumentRepository(db);
    this.dsRepo = createDataSourceRepository(db);
    this.kbRepo = createKnowledgeBaseRepository(db);
  }

  private async assertDataSourceOwnership(dataSourceId: string): Promise<void> {
    const ds = await this.dsRepo.findById(dataSourceId);
    if (!ds) throw new Error(`DataSource ${dataSourceId} not found`);
    const kb = await this.kbRepo.findById(ds.knowledgeBaseId);
    if (!kb || kb.tenantId !== this.tenantId) {
      throw new Error(`DataSource ${dataSourceId} not found`);
    }
  }

  async list(
    dataSourceId: string,
    params?: PaginationParams & { status?: string }
  ): Promise<PaginatedResult<DocumentRecord>> {
    await this.assertDataSourceOwnership(dataSourceId);
    return this.docRepo.findByDataSourceId(dataSourceId, params);
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const doc = await this.docRepo.findById(id);
    if (!doc) return null;
    await this.assertDataSourceOwnership(doc.dataSourceId);
    return doc;
  }

  async create(input: CreateDocumentRecord): Promise<DocumentRecord> {
    docLogger.info(
      { dataSourceId: input.dataSourceId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      'Creating document record'
    );
    await this.assertDataSourceOwnership(input.dataSourceId);
    try {
      const doc = await this.docRepo.create(input);
      docLogger.info({ documentId: doc.id }, 'Document record created successfully');
      return doc;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      docLogger.error(
        { dataSourceId: input.dataSourceId, fileName: input.fileName, errorMessage: error.message, errorStack: error.stack },
        'Failed to create document record'
      );
      throw error;
    }
  }

  async update(id: string, input: UpdateDocumentRecord): Promise<DocumentRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.docRepo.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.docRepo.delete(id);
    return true;
  }

  /**
   * Generate a pre-signed S3 upload URL for a document.
   */
  async getUploadUrl(
    dataSourceId: string,
    fileName: string,
    mimeType: string,
    expiresIn = 3600
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    docLogger.info(
      { dataSourceId, fileName, mimeType, expiresIn },
      'Generating pre-signed S3 upload URL'
    );
    await this.assertDataSourceOwnership(dataSourceId);

    const s3Key = `${this.tenantId}/${dataSourceId}/${Date.now()}-${fileName}`;
    docLogger.debug({ s3Key }, 'S3 key generated');

    try {
      const uploadUrl = await this.s3.getUploadUrl(s3Key, mimeType, expiresIn);
      docLogger.info({ s3Key }, 'Pre-signed S3 upload URL generated successfully');
      return { uploadUrl, s3Key };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      docLogger.error(
        { dataSourceId, fileName, s3Key, errorMessage: error.message, errorStack: error.stack },
        'Failed to generate pre-signed S3 upload URL'
      );
      throw error;
    }
  }

  /**
   * Download a document from S3 and return its buffer.
   */
  async downloadFromS3(s3Key: string): Promise<Buffer> {
    return this.s3.downloadAsBuffer(s3Key);
  }
}

// ─── IngestionService ─────────────────────────────────────────────────────────

const ingestionLogger = createLogger('kb:ingestion-service');

export interface IngestionJobPayload {
  documentId: string;
  tenantId: string;
  s3Key: string;
  mimeType: string;
  knowledgeBaseId: string;
}

export class IngestionService {
  constructor(private readonly tenantId: string) {}

  /**
   * Enqueue a document ingestion job via pg-boss.
   * The boss instance must be passed in to avoid a circular dependency.
   */
  async enqueueIngestion(
    boss: { send: (name: string, data: object) => Promise<string | null> },
    payload: IngestionJobPayload
  ): Promise<string | null> {
    ingestionLogger.info(
      { documentId: payload.documentId, knowledgeBaseId: payload.knowledgeBaseId, tenantId: payload.tenantId },
      'Enqueuing document ingestion job'
    );
    try {
      const jobId = await boss.send('document-ingestion', payload);
      ingestionLogger.info({ jobId, documentId: payload.documentId }, 'Document ingestion job enqueued successfully');
      return jobId;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ingestionLogger.error(
        { documentId: payload.documentId, knowledgeBaseId: payload.knowledgeBaseId, errorMessage: error.message, errorStack: error.stack },
        'Failed to enqueue document ingestion job'
      );
      throw error;
    }
  }
}
