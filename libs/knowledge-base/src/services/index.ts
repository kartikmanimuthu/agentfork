import { getPrismaClient } from '@chatbot/shared/workers';
import { S3Service } from '@chatbot/shared';
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

export class KnowledgeBaseService {
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;

  constructor(private readonly tenantId: string) {
    const db = getPrismaClient();
    this.kbRepo = createKnowledgeBaseRepository(db);
  }

  async list(
    params: PaginationParams & { status?: string } = {}
  ): Promise<PaginatedResult<KnowledgeBaseRecord>> {
    return this.kbRepo.findByTenantId(this.tenantId, params);
  }

  async get(id: string): Promise<KnowledgeBaseRecord | null> {
    const kb = await this.kbRepo.findById(id);
    if (!kb || kb.tenantId !== this.tenantId) return null;
    return kb;
  }

  async create(input: Omit<CreateKnowledgeBaseRecord, 'tenantId'>): Promise<KnowledgeBaseRecord> {
    return this.kbRepo.create({ ...input, tenantId: this.tenantId });
  }

  async update(id: string, input: UpdateKnowledgeBaseRecord): Promise<KnowledgeBaseRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.kbRepo.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.kbRepo.delete(id);
    return true;
  }
}

// ─── DataSourceService ────────────────────────────────────────────────────────

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
    await this.assertKbOwnership(knowledgeBaseId);
    return this.dsRepo.findByKnowledgeBaseId(knowledgeBaseId, params);
  }

  async get(id: string): Promise<DataSourceRecord | null> {
    const ds = await this.dsRepo.findById(id);
    if (!ds) return null;
    await this.assertKbOwnership(ds.knowledgeBaseId);
    return ds;
  }

  async create(input: CreateDataSourceRecord): Promise<DataSourceRecord> {
    await this.assertKbOwnership(input.knowledgeBaseId);
    return this.dsRepo.create(input);
  }

  async update(id: string, input: UpdateDataSourceRecord): Promise<DataSourceRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.dsRepo.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.dsRepo.delete(id);
    return true;
  }
}

// ─── DocumentService ──────────────────────────────────────────────────────────

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
    await this.assertDataSourceOwnership(input.dataSourceId);
    return this.docRepo.create(input);
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
    await this.assertDataSourceOwnership(dataSourceId);

    const s3Key = `${this.tenantId}/${dataSourceId}/${Date.now()}-${fileName}`;
    const uploadUrl = await this.s3.getUploadUrl(s3Key, mimeType, expiresIn);
    return { uploadUrl, s3Key };
  }

  /**
   * Download a document from S3 and return its buffer.
   */
  async downloadFromS3(s3Key: string): Promise<Buffer> {
    return this.s3.downloadAsBuffer(s3Key);
  }
}

// ─── IngestionService ─────────────────────────────────────────────────────────

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
  async enqueueIngestion(boss: { send: (name: string, data: object) => Promise<string | null> }, payload: IngestionJobPayload): Promise<string | null> {
    return boss.send('document-ingestion', payload);
  }
}
