export type EmbeddingProviderType = 'BEDROCK_TITAN' | 'OPENAI' | 'COHERE' | 'LOCAL';

export type ChunkStrategy =
  | 'FIXED_SIZE'
  | 'RECURSIVE_CHARACTER'
  | 'SEMANTIC'
  | 'MARKDOWN_AWARE'
  | 'CODE_AWARE';

export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'CHUNKING' | 'EMBEDDING' | 'READY' | 'FAILED';

export type DataSourceType = 'FILE' | 'URL' | 'CONNECTOR';

export type DataSourceStatus = 'active' | 'syncing' | 'error' | 'disabled';

export type KnowledgeBaseStatus = 'active' | 'archived';

export type SearchMode = 'DENSE' | 'SPARSE' | 'HYBRID';

export type RerankProvider = 'COHERE' | 'CROSS_ENCODER' | 'NONE';

export interface PreProcessingConfig {
  htmlStripping: boolean;
  piiRedaction: boolean;
  piiPatterns?: string[];
  ocrEnabled: boolean;
  tableExtraction: boolean;
}

export interface RetrievalConfig {
  topK: number;
  similarityThreshold: number;
  searchMode: SearchMode;
  hybridAlpha: number;
  rerankProvider: RerankProvider;
  rerankTopK?: number;
  useCompression: boolean;
}

export interface MetadataFilter {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'lt' | 'between';
  value: unknown;
}

export interface RetrievalOptions {
  knowledgeBaseId: string;
  topK?: number;
  similarityThreshold?: number;
  searchMode?: SearchMode;
  hybridAlpha?: number;
  metadataFilters?: MetadataFilter[];
  rerankProvider?: RerankProvider;
  rerankTopK?: number;
  useCompression?: boolean;
}

export interface RetrievalResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  documentId: string;
  documentName: string;
}

export interface DetailedRetrievalResult extends RetrievalResult {
  denseScore?: number;
  sparseScore?: number;
  rrfScore?: number;
  rerankScore?: number;
  compressionKept: boolean;
}

export interface ChunkResult {
  content: string;
  metadata: Record<string, unknown>;
  tokenCount: number;
}

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface Reranker {
  rerank(query: string, chunks: RetrievalResult[], topK: number): Promise<RetrievalResult[]>;
}

export interface DocumentParser {
  parse(buffer: Buffer, mimeType: string): Promise<string>;
}

export interface Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[];
}
