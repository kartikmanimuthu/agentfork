import { z } from 'zod';

// ─── Shared enums ────────────────────────────────────────────────────────────

export const embeddingProviderSchema = z.string().min(1);

export const chunkStrategySchema = z.enum([
  'FIXED_SIZE',
  'RECURSIVE_CHARACTER',
  'SEMANTIC',
  'MARKDOWN_AWARE',
  'CODE_AWARE',
]);

export const documentStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'CHUNKING',
  'EMBEDDING',
  'READY',
  'FAILED',
]);

export const dataSourceTypeSchema = z.enum(['FILE', 'URL', 'CONNECTOR']);

export const dataSourceStatusSchema = z.enum(['active', 'syncing', 'error', 'disabled']);

export const knowledgeBaseStatusSchema = z.enum(['active', 'archived']);

export const searchModeSchema = z.enum(['DENSE', 'SPARSE', 'HYBRID']);

export const rerankProviderSchema = z.enum(['COHERE', 'CROSS_ENCODER', 'NONE']);

// ─── Pre-processing config ────────────────────────────────────────────────────

export const preProcessingConfigSchema = z.object({
  htmlStripping: z.boolean().default(true),
  piiRedaction: z.boolean().default(false),
  piiPatterns: z.array(z.string()).optional(),
  ocrEnabled: z.boolean().default(false),
  tableExtraction: z.boolean().default(true),
});

// ─── Retrieval config ─────────────────────────────────────────────────────────

export const retrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(100).default(10),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  searchMode: searchModeSchema.default('HYBRID'),
  hybridAlpha: z.number().min(0).max(1).default(0.7),
  rerankProvider: rerankProviderSchema.default('NONE'),
  rerankTopK: z.number().int().min(1).max(100).optional(),
  useCompression: z.boolean().default(false),
});

// ─── KnowledgeBase ────────────────────────────────────────────────────────────

export const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  embeddingProvider: embeddingProviderSchema,
  embeddingModel: z.string().min(1),
  embeddingDimensions: z.number().int().min(64).max(3072).default(1024),
  chunkStrategy: chunkStrategySchema.default('RECURSIVE_CHARACTER'),
  chunkSize: z.number().int().min(64).max(8192).default(512),
  chunkOverlap: z.number().int().min(0).max(512).default(50),
  preProcessing: preProcessingConfigSchema.optional(),
  retrievalConfig: retrievalConfigSchema.optional(),
});

export const updateKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  embeddingProvider: embeddingProviderSchema.optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().min(64).max(3072).optional(),
  chunkStrategy: chunkStrategySchema.optional(),
  chunkSize: z.number().int().min(64).max(8192).optional(),
  chunkOverlap: z.number().int().min(0).max(512).optional(),
  preProcessing: preProcessingConfigSchema.optional(),
  retrievalConfig: retrievalConfigSchema.optional(),
  status: knowledgeBaseStatusSchema.optional(),
});

// ─── DataSource ───────────────────────────────────────────────────────────────

export const fileDataSourceConfigSchema = z.object({
  allowedMimeTypes: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
});

export const urlDataSourceConfigSchema = z.object({
  urls: z.array(z.string().url()).min(1),
  crawlDepth: z.number().int().min(0).max(5).default(0),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

export const connectorDataSourceConfigSchema = z.object({
  connectorType: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const dataSourceConfigSchema = z.union([
  fileDataSourceConfigSchema,
  urlDataSourceConfigSchema,
  connectorDataSourceConfigSchema,
]);

export const createDataSourceSchema = z.object({
  knowledgeBaseId: z.string().cuid(),
  type: dataSourceTypeSchema,
  config: z.record(z.string(), z.unknown()),
  syncSchedule: z.string().optional(),
});

export const updateDataSourceSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  status: dataSourceStatusSchema.optional(),
  syncSchedule: z.string().nullable().optional(),
});

// ─── Document ─────────────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  dataSourceId: z.string().cuid(),
  sourceKey: z.string().min(1),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateDocumentStatusSchema = z.object({
  status: documentStatusSchema,
  errorMessage: z.string().optional(),
  tokenCount: z.number().int().nonnegative().optional(),
});

// ─── Retrieval ────────────────────────────────────────────────────────────────

export const metadataFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'between']),
  value: z.unknown(),
});

export const retrievalOptionsSchema = z.object({
  knowledgeBaseId: z.string().cuid(),
  topK: z.number().int().min(1).max(100).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  searchMode: searchModeSchema.optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  metadataFilters: z.array(metadataFilterSchema).optional(),
  rerankProvider: rerankProviderSchema.optional(),
  rerankTopK: z.number().int().min(1).max(100).optional(),
  useCompression: z.boolean().optional(),
});

// ─── Test retrieval ───────────────────────────────────────────────────────────

export const testRetrievalSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(100).optional(),
  searchMode: searchModeSchema.optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  rerankProvider: rerankProviderSchema.optional(),
});

// ─── Multi-KB search ──────────────────────────────────────────────────────────

export const multiKbSearchSchema = z.object({
  query: z.string().min(1),
  knowledgeBaseIds: z.array(z.string().cuid()).min(1),
  topK: z.number().int().min(1).max(100).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  searchMode: searchModeSchema.optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  rerankProvider: rerankProviderSchema.optional(),
});

// ─── Crawl trigger ────────────────────────────────────────────────────────────

export const crawlTriggerSchema = z.object({
  sourceId: z.string().cuid(),
});

// ─── Agent KB attach ──────────────────────────────────────────────────────────

export const agentAttachKbSchema = z.object({
  knowledgeBaseId: z.string().cuid(),
});

// ─── Source sync ──────────────────────────────────────────────────────────────

export const syncSourceSchema = z.object({
  force: z.boolean().optional(),
});

// ─── Query param schemas ──────────────────────────────────────────────────────

export const kbListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

export const sourceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const documentListQuerySchema = z.object({
  sourceId: z.string().cuid(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

export const chunkListQuerySchema = z.object({
  documentId: z.string().cuid(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const umapQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export const documentQuerySchema = z.object({
  sourceId: z.string().cuid(),
});

export const chunkQuerySchema = z.object({
  documentId: z.string().cuid(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;
export type UpdateKnowledgeBaseInput = z.infer<typeof updateKnowledgeBaseSchema>;
export type CreateDataSourceInput = z.infer<typeof createDataSourceSchema>;
export type UpdateDataSourceInput = z.infer<typeof updateDataSourceSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentStatusInput = z.infer<typeof updateDocumentStatusSchema>;
export type RetrievalOptionsInput = z.infer<typeof retrievalOptionsSchema>;
export type MetadataFilterInput = z.infer<typeof metadataFilterSchema>;
export type PreProcessingConfigInput = z.infer<typeof preProcessingConfigSchema>;
export type RetrievalConfigInput = z.infer<typeof retrievalConfigSchema>;
export type TestRetrievalInput = z.infer<typeof testRetrievalSchema>;
export type MultiKbSearchInput = z.infer<typeof multiKbSearchSchema>;
export type CrawlTriggerInput = z.infer<typeof crawlTriggerSchema>;
export type AgentAttachKbInput = z.infer<typeof agentAttachKbSchema>;
export type SyncSourceInput = z.infer<typeof syncSourceSchema>;
export type KbListQueryInput = z.infer<typeof kbListQuerySchema>;
export type SourceListQueryInput = z.infer<typeof sourceListQuerySchema>;
export type DocumentListQueryInput = z.infer<typeof documentListQuerySchema>;
export type ChunkListQueryInput = z.infer<typeof chunkListQuerySchema>;
export type UmapQueryInput = z.infer<typeof umapQuerySchema>;
export type DocumentQueryInput = z.infer<typeof documentQuerySchema>;
export type ChunkQueryInput = z.infer<typeof chunkQuerySchema>;
