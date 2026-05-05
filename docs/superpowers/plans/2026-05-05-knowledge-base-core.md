# Knowledge Base Core Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core knowledge base module as a new Nx library with file ingestion, multi-provider embeddings, full retrieval stack, and testing UI.

**Architecture:** New `libs/knowledge-base` Nx library following existing repository/service patterns from `libs/shared`. Workers handle async ingestion via pg-boss job chain. API routes in `apps/web-ui` follow existing Next.js App Router conventions. pgvector for dense search, tsvector for sparse/BM25, RRF for hybrid merge.

**Tech Stack:** TypeScript, Prisma + pgvector, pg-boss, S3, AWS Textract, OpenAI/Cohere/Bedrock/Ollama embeddings, Vitest, Next.js 15 App Router

**Spec:** `docs/specs/2026-05-05-knowledge-base-core.md`

---

## File Map

### New Nx Library: `libs/knowledge-base/`

| File | Responsibility |
|------|---------------|
| `project.json` | Nx project config (build + test targets) |
| `tsconfig.json` | Extends base tsconfig |
| `tsconfig.lib.json` | Library build config |
| `vitest.config.ts` | Test config |
| `src/index.ts` | Public barrel export |
| `src/types.ts` | All KB types, enums, interfaces |
| `src/env.ts` | KB-specific env var loading |

### Repositories (`src/db/repositories/`)

| File | Responsibility |
|------|---------------|
| `knowledge-base/interface.ts` | KB repository interface + record types |
| `knowledge-base/postgres.ts` | Prisma implementation |
| `data-source/interface.ts` | DataSource repository interface |
| `data-source/postgres.ts` | Prisma implementation |
| `document/interface.ts` | Document repository interface |
| `document/postgres.ts` | Prisma implementation |
| `document-chunk/interface.ts` | DocumentChunk repository interface |
| `document-chunk/postgres.ts` | Prisma implementation (raw SQL for vectors) |
| `repository-factory.ts` | Factory functions for all KB repositories |

### Validation (`src/validation/schemas/`)

| File | Responsibility |
|------|---------------|
| `knowledge-base.ts` | Zod schemas for KB CRUD |
| `data-source.ts` | Zod schemas for data source operations |
| `document.ts` | Zod schemas for document operations |
| `retrieval.ts` | Zod schemas for search/test queries |

### Ingestion (`src/ingestion/`)

| File | Responsibility |
|------|---------------|
| `parsers/pdf-parser.ts` | PDF text extraction (pdf-parse + Textract fallback) |
| `parsers/docx-parser.ts` | DOCX conversion (mammoth) |
| `parsers/text-parser.ts` | TXT, MD, CSV, JSON parsing |
| `parsers/html-parser.ts` | HTML → text |
| `parsers/xlsx-parser.ts` | XLSX → markdown tables |
| `parsers/parser-factory.ts` | Select parser by MIME type |
| `pre-processing/html-stripper.ts` | Strip HTML tags |
| `pre-processing/pii-redactor.ts` | Regex-based PII redaction |
| `pre-processing/ocr-processor.ts` | AWS Textract OCR |
| `pre-processing/table-extractor.ts` | Table → markdown |
| `pre-processing/pipeline.ts` | Orchestrate pre-processing steps |
| `chunking/fixed-size.ts` | Fixed-size chunking |
| `chunking/recursive-character.ts` | Recursive character splitting |
| `chunking/semantic.ts` | Sentence-level splitting |
| `chunking/markdown-aware.ts` | Heading-aware splitting |
| `chunking/code-aware.ts` | Code block splitting |
| `chunking/chunker-factory.ts` | Select strategy by config |

### Embeddings (`src/embeddings/`)

| File | Responsibility |
|------|---------------|
| `provider.ts` | EmbeddingProvider interface |
| `bedrock-titan.ts` | Bedrock Titan implementation |
| `openai.ts` | OpenAI implementation |
| `cohere.ts` | Cohere implementation |
| `local-ollama.ts` | Ollama implementation |
| `provider-factory.ts` | Create provider from KB config |

### Retrieval (`src/retrieval/`)

| File | Responsibility |
|------|---------------|
| `search/dense-search.ts` | pgvector cosine similarity |
| `search/sparse-search.ts` | tsvector BM25 |
| `search/hybrid-search.ts` | RRF merge |
| `reranking/cohere-reranker.ts` | Cohere Rerank API |
| `reranking/cross-encoder-reranker.ts` | Local cross-encoder via Ollama |
| `reranking/reranker-factory.ts` | Select reranker by config |
| `compression/contextual-compressor.ts` | LLM-based relevance filter |
| `retrieval-service.ts` | Main retrieval orchestrator |

### Testing (`src/testing/`)

| File | Responsibility |
|------|---------------|
| `umap-projector.ts` | UMAP 2D projection + caching |

### Services (`src/services/`)

| File | Responsibility |
|------|---------------|
| `knowledge-base-service.ts` | KB CRUD orchestration |
| `document-service.ts` | Document lifecycle + S3 upload |
| `ingestion-service.ts` | Job enqueuing for ingestion pipeline |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add KnowledgeBase, DataSource, Document, DocumentChunk models + Tenant relation |
| `tsconfig.base.json` | Add `@chatbot/knowledge-base` path alias |
| `apps/web-ui/next.config.ts` | Add `@chatbot/knowledge-base` to transpilePackages |
| `apps/workers/src/main.ts` | Register KB job handlers |

### New API Routes (`apps/web-ui/app/api/knowledge-base/`)

| File | Responsibility |
|------|---------------|
| `route.ts` | POST (create KB), GET (list KBs) |
| `[id]/route.ts` | GET (detail), PATCH (update), DELETE |
| `[id]/sources/route.ts` | POST (add source), GET (list sources) |
| `[id]/sources/[sid]/route.ts` | DELETE (remove source) |
| `[id]/sources/[sid]/sync/route.ts` | POST (trigger re-sync) |
| `[id]/documents/route.ts` | GET (list documents) |
| `[id]/documents/[did]/route.ts` | GET (detail), DELETE |
| `[id]/upload/route.ts` | POST (presigned S3 URL) |
| `[id]/search/route.ts` | POST (search single KB) |
| `search/route.ts` | POST (search across KBs) |
| `[id]/test/route.ts` | POST (detailed retrieval test) |
| `[id]/chunks/route.ts` | GET (browse chunks) |
| `[id]/chunks/embeddings/route.ts` | GET (UMAP projections) |
| `[id]/stats/route.ts` | GET (ingestion stats) |

### New Worker Jobs (`apps/workers/src/jobs/`)

| File | Responsibility |
|------|---------------|
| `kb-ingest/handler.ts` | Create document record, enqueue parse |
| `kb-ingest/register.ts` | Register with pg-boss |
| `kb-parse/handler.ts` | Download from S3, parse, pre-process |
| `kb-parse/register.ts` | Register with pg-boss |
| `kb-chunk/handler.ts` | Chunk text, store chunks + tsvector |
| `kb-chunk/register.ts` | Register with pg-boss |
| `kb-embed/handler.ts` | Generate embeddings, store vectors |
| `kb-embed/register.ts` | Register with pg-boss |

### New UI Pages (`apps/web-ui/app/(dashboard)/knowledge-base/`)

| File | Responsibility |
|------|---------------|
| `page.tsx` | KB list with cards |
| `create/page.tsx` | Create KB wizard |
| `[id]/page.tsx` | KB detail overview |
| `[id]/settings/page.tsx` | Edit KB config |
| `[id]/documents/page.tsx` | Document list + upload |
| `[id]/test/page.tsx` | Retrieval tester + chunk browser |
| `[id]/visualize/page.tsx` | UMAP visualization |

---

## Tasks

### Task 1: Nx Library Scaffold + Prisma Schema

**Files:**
- Create: `libs/knowledge-base/project.json`
- Create: `libs/knowledge-base/tsconfig.json`
- Create: `libs/knowledge-base/tsconfig.lib.json`
- Create: `libs/knowledge-base/vitest.config.ts`
- Create: `libs/knowledge-base/src/index.ts`
- Create: `libs/knowledge-base/src/types.ts`
- Create: `libs/knowledge-base/src/env.ts`
- Modify: `tsconfig.base.json` (add path alias)
- Modify: `prisma/schema.prisma` (add KB models + Tenant relation)

- [ ] **Step 1: Create `libs/knowledge-base/project.json`**

```json
{
  "name": "knowledge-base",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/knowledge-base/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/knowledge-base",
        "tsConfig": "libs/knowledge-base/tsconfig.lib.json",
        "main": "libs/knowledge-base/src/index.ts"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bunx vitest run",
        "cwd": "libs/knowledge-base"
      }
    }
  }
}
```

- [ ] **Step 2: Create `libs/knowledge-base/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" }
  ]
}
```

- [ ] **Step 3: Create `libs/knowledge-base/tsconfig.lib.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/libs/knowledge-base",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Create `libs/knowledge-base/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
      },
    },
  },
});
```

- [ ] **Step 5: Add path alias to `tsconfig.base.json`**

Add to `compilerOptions.paths`:
```json
"@chatbot/knowledge-base": ["libs/knowledge-base/src/index.ts"]
```

- [ ] **Step 6: Create `libs/knowledge-base/src/types.ts`**

```typescript
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
```

- [ ] **Step 7: Create `libs/knowledge-base/src/env.ts`**

```typescript
import { z } from 'zod';

const kbEnvSchema = z.object({
  KB_S3_BUCKET: z.string().min(1),
  AWS_REGION: z.string().default('ap-south-1'),
  OPENAI_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
});

export const kbEnv = kbEnvSchema.parse(process.env);
```

- [ ] **Step 8: Add Prisma models to `prisma/schema.prisma`**

Add the four new models (KnowledgeBase, DataSource, Document, DocumentChunk) and the `knowledgeBases` relation on Tenant exactly as specified in the design spec.

- [ ] **Step 9: Create migration**

Run: `bunx prisma migrate dev --name add-knowledge-base-models`

Then add raw SQL to the migration for the vector column, indexes:

```sql
ALTER TABLE document_chunks ADD COLUMN embedding vector(3072);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_document_chunks_search_text ON document_chunks USING gin (search_text);
CREATE INDEX idx_document_chunks_metadata ON document_chunks USING gin (metadata jsonb_path_ops);
```

- [ ] **Step 10: Create `libs/knowledge-base/src/index.ts`** (empty barrel, populated as we add modules)

```typescript
export * from './types';
export { kbEnv } from './env';
```

- [ ] **Step 11: Verify build**

Run: `nx build knowledge-base`
Expected: Successful build with no errors

- [ ] **Step 12: Commit**

```bash
git add libs/knowledge-base/ prisma/schema.prisma prisma/migrations/ tsconfig.base.json
git commit -m "feat(knowledge-base): scaffold Nx library and Prisma schema

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 2: Validation Schemas

**Files:**
- Create: `libs/knowledge-base/src/validation/schemas/knowledge-base.ts`
- Create: `libs/knowledge-base/src/validation/schemas/data-source.ts`
- Create: `libs/knowledge-base/src/validation/schemas/document.ts`
- Create: `libs/knowledge-base/src/validation/schemas/retrieval.ts`
- Create: `libs/knowledge-base/src/validation/index.ts`

- [ ] **Step 1: Create `libs/knowledge-base/src/validation/schemas/knowledge-base.ts`**

```typescript
import { z } from 'zod';

export const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  embeddingProvider: z.enum(['BEDROCK_TITAN', 'OPENAI', 'COHERE', 'LOCAL']).default('BEDROCK_TITAN'),
  embeddingModel: z.string().default('amazon.titan-embed-text-v2:0'),
  embeddingDimensions: z.number().int().min(256).max(3072).default(1024),
  chunkStrategy: z.enum(['FIXED_SIZE', 'RECURSIVE_CHARACTER', 'SEMANTIC', 'MARKDOWN_AWARE', 'CODE_AWARE']).default('RECURSIVE_CHARACTER'),
  chunkSize: z.number().int().min(100).max(4000).default(512),
  chunkOverlap: z.number().int().min(0).max(500).default(50),
  preProcessing: z.object({
    htmlStripping: z.boolean().default(true),
    piiRedaction: z.boolean().default(false),
    piiPatterns: z.array(z.string()).optional(),
    ocrEnabled: z.boolean().default(false),
    tableExtraction: z.boolean().default(true),
  }).default({}),
  retrievalConfig: z.object({
    topK: z.number().int().min(1).max(100).default(10),
    similarityThreshold: z.number().min(0).max(1).default(0.7),
    searchMode: z.enum(['DENSE', 'SPARSE', 'HYBRID']).default('HYBRID'),
    hybridAlpha: z.number().min(0).max(1).default(0.7),
    rerankProvider: z.enum(['COHERE', 'CROSS_ENCODER', 'NONE']).default('NONE'),
    rerankTopK: z.number().int().min(1).max(50).optional(),
    useCompression: z.boolean().default(false),
  }).default({}),
});

export const updateKnowledgeBaseSchema = createKnowledgeBaseSchema.partial();

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;
export type UpdateKnowledgeBaseInput = z.infer<typeof updateKnowledgeBaseSchema>;
```

- [ ] **Step 2: Create `libs/knowledge-base/src/validation/schemas/data-source.ts`**

```typescript
import { z } from 'zod';

export const createDataSourceSchema = z.object({
  type: z.enum(['FILE', 'URL', 'CONNECTOR']),
  config: z.record(z.unknown()),
  syncSchedule: z.string().optional(),
});

export type CreateDataSourceInput = z.infer<typeof createDataSourceSchema>;
```

- [ ] **Step 3: Create `libs/knowledge-base/src/validation/schemas/document.ts`**

```typescript
import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const documentQuerySchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
```

- [ ] **Step 4: Create `libs/knowledge-base/src/validation/schemas/retrieval.ts`**

```typescript
import { z } from 'zod';

const metadataFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'between']),
  value: z.unknown(),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(5000),
  topK: z.number().int().min(1).max(100).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  searchMode: z.enum(['DENSE', 'SPARSE', 'HYBRID']).optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
  metadataFilters: z.array(metadataFilterSchema).optional(),
  rerankProvider: z.enum(['COHERE', 'CROSS_ENCODER', 'NONE']).optional(),
  rerankTopK: z.number().int().min(1).max(50).optional(),
  useCompression: z.boolean().optional(),
});

export const multiKBSearchSchema = searchSchema.extend({
  knowledgeBaseIds: z.array(z.string().min(1)).min(1).max(10),
});

export const chunkQuerySchema = z.object({
  documentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SearchInput = z.infer<typeof searchSchema>;
export type MultiKBSearchInput = z.infer<typeof multiKBSearchSchema>;
```

- [ ] **Step 5: Create `libs/knowledge-base/src/validation/index.ts`**

```typescript
export * from './schemas/knowledge-base';
export * from './schemas/data-source';
export * from './schemas/document';
export * from './schemas/retrieval';
```

- [ ] **Step 6: Update barrel export in `libs/knowledge-base/src/index.ts`**

```typescript
export * from './types';
export { kbEnv } from './env';
export * from './validation';
```

- [ ] **Step 7: Verify build**

Run: `nx build knowledge-base`
Expected: Successful build

- [ ] **Step 8: Commit**

```bash
git add libs/knowledge-base/src/validation/
git commit -m "feat(knowledge-base): add Zod validation schemas

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 3: Repositories

**Files:**
- Create: `libs/knowledge-base/src/db/repositories/knowledge-base/interface.ts`
- Create: `libs/knowledge-base/src/db/repositories/knowledge-base/postgres.ts`
- Create: `libs/knowledge-base/src/db/repositories/data-source/interface.ts`
- Create: `libs/knowledge-base/src/db/repositories/data-source/postgres.ts`
- Create: `libs/knowledge-base/src/db/repositories/document/interface.ts`
- Create: `libs/knowledge-base/src/db/repositories/document/postgres.ts`
- Create: `libs/knowledge-base/src/db/repositories/document-chunk/interface.ts`
- Create: `libs/knowledge-base/src/db/repositories/document-chunk/postgres.ts`
- Create: `libs/knowledge-base/src/db/repositories/repository-factory.ts`
- Test: `libs/knowledge-base/src/db/repositories/knowledge-base/postgres.test.ts`

- [ ] **Step 1: Create `knowledge-base/interface.ts`**

```typescript
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type { KnowledgeBaseStatus, PreProcessingConfig, RetrievalConfig, ChunkStrategy, EmbeddingProviderType } from '../../../types';

export interface KnowledgeBaseRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  embeddingProvider: EmbeddingProviderType;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  preProcessing: PreProcessingConfig;
  retrievalConfig: RetrievalConfig;
  status: KnowledgeBaseStatus;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeBaseInput {
  tenantId: string;
  name: string;
  description?: string;
  embeddingProvider?: EmbeddingProviderType;
  embeddingModel?: string;
  embeddingDimensions?: number;
  chunkStrategy?: ChunkStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
  preProcessing?: PreProcessingConfig;
  retrievalConfig?: RetrievalConfig;
}

export interface UpdateKnowledgeBaseInput {
  name?: string;
  description?: string;
  chunkStrategy?: ChunkStrategy;
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
  findByTenantId(tenantId: string, params?: PaginationParams): Promise<PaginatedResult<KnowledgeBaseRecord>>;
  create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseRecord>;
  update(id: string, input: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseRecord>;
  delete(id: string): Promise<void>;
  incrementDocumentCount(id: string, by?: number): Promise<void>;
  incrementChunkCount(id: string, by: number): Promise<void>;
}
```

- [ ] **Step 2: Create `knowledge-base/postgres.ts`**

```typescript
import type { KnowledgeBaseRepository, KnowledgeBaseRecord, CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput } from './interface';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

export class PostgresKnowledgeBaseRepository implements KnowledgeBaseRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<KnowledgeBaseRecord | null> {
    return this.db.knowledgeBase.findUnique({ where: { id } });
  }

  async findByTenantId(tenantId: string, params: PaginationParams = {}): Promise<PaginatedResult<KnowledgeBaseRecord>> {
    const { limit = 20, offset = 0 } = params;
    const [items, total] = await Promise.all([
      this.db.knowledgeBase.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.knowledgeBase.count({ where: { tenantId, status: 'active' } }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseRecord> {
    return this.db.knowledgeBase.create({ data: input });
  }

  async update(id: string, input: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseRecord> {
    return this.db.knowledgeBase.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.knowledgeBase.delete({ where: { id } });
  }

  async incrementDocumentCount(id: string, by = 1): Promise<void> {
    await this.db.knowledgeBase.update({
      where: { id },
      data: { documentCount: { increment: by } },
    });
  }

  async incrementChunkCount(id: string, by: number): Promise<void> {
    await this.db.knowledgeBase.update({
      where: { id },
      data: { chunkCount: { increment: by } },
    });
  }
}
```

- [ ] **Step 3: Create `data-source/interface.ts`**

```typescript
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type { DataSourceType, DataSourceStatus } from '../../../types';

export interface DataSourceRecord {
  id: string;
  knowledgeBaseId: string;
  type: DataSourceType;
  config: Record<string, unknown>;
  status: DataSourceStatus;
  lastSyncAt: Date | null;
  syncSchedule: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDataSourceInput {
  knowledgeBaseId: string;
  type: DataSourceType;
  config: Record<string, unknown>;
  syncSchedule?: string;
}

export interface DataSourceRepository {
  findById(id: string): Promise<DataSourceRecord | null>;
  findByKnowledgeBaseId(kbId: string, params?: PaginationParams): Promise<PaginatedResult<DataSourceRecord>>;
  create(input: CreateDataSourceInput): Promise<DataSourceRecord>;
  updateStatus(id: string, status: DataSourceStatus, errorMessage?: string): Promise<void>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 4: Create `data-source/postgres.ts`**

Follow the same pattern as `PostgresKnowledgeBaseRepository`. Use `this.db.dataSource` for all queries. `findByKnowledgeBaseId` filters by `knowledgeBaseId`, orders by `createdAt desc`.

```typescript
import type { DataSourceRepository, DataSourceRecord, CreateDataSourceInput } from './interface';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type { DataSourceStatus } from '../../../types';

export class PostgresDataSourceRepository implements DataSourceRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DataSourceRecord | null> {
    return this.db.dataSource.findUnique({ where: { id } });
  }

  async findByKnowledgeBaseId(kbId: string, params: PaginationParams = {}): Promise<PaginatedResult<DataSourceRecord>> {
    const { limit = 20, offset = 0 } = params;
    const [items, total] = await Promise.all([
      this.db.dataSource.findMany({ where: { knowledgeBaseId: kbId }, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.db.dataSource.count({ where: { knowledgeBaseId: kbId } }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateDataSourceInput): Promise<DataSourceRecord> {
    return this.db.dataSource.create({ data: input });
  }

  async updateStatus(id: string, status: DataSourceStatus, errorMessage?: string): Promise<void> {
    await this.db.dataSource.update({ where: { id }, data: { status, errorMessage: errorMessage ?? null, lastSyncAt: status === 'active' ? new Date() : undefined } });
  }

  async delete(id: string): Promise<void> {
    await this.db.dataSource.delete({ where: { id } });
  }
}
```

- [ ] **Step 5: Create `document/interface.ts`**

```typescript
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type { DocumentStatus } from '../../../types';

export interface DocumentRecord {
  id: string;
  dataSourceId: string;
  sourceKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown> | null;
  processedText: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  tokenCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDocumentInput {
  dataSourceId: string;
  sourceKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentRepository {
  findById(id: string): Promise<DocumentRecord | null>;
  findByDataSourceId(dsId: string, params?: PaginationParams & { status?: DocumentStatus }): Promise<PaginatedResult<DocumentRecord>>;
  findByKnowledgeBaseId(kbId: string, params?: PaginationParams & { status?: DocumentStatus }): Promise<PaginatedResult<DocumentRecord>>;
  create(input: CreateDocumentInput): Promise<DocumentRecord>;
  updateStatus(id: string, status: DocumentStatus, errorMessage?: string): Promise<void>;
  updateProcessedText(id: string, text: string): Promise<void>;
  updateTokenCount(id: string, tokenCount: number): Promise<void>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 6: Create `document/postgres.ts`**

```typescript
import type { DocumentRepository, DocumentRecord, CreateDocumentInput } from './interface';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';
import type { DocumentStatus } from '../../../types';

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentRecord | null> {
    return this.db.document.findUnique({ where: { id } });
  }

  async findByDataSourceId(dsId: string, params: PaginationParams & { status?: DocumentStatus } = {}): Promise<PaginatedResult<DocumentRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = { dataSourceId: dsId, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.db.document.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.db.document.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async findByKnowledgeBaseId(kbId: string, params: PaginationParams & { status?: DocumentStatus } = {}): Promise<PaginatedResult<DocumentRecord>> {
    const { limit = 20, offset = 0, status } = params;
    const where = { dataSource: { knowledgeBaseId: kbId }, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.db.document.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.db.document.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    return this.db.document.create({ data: input });
  }

  async updateStatus(id: string, status: DocumentStatus, errorMessage?: string): Promise<void> {
    await this.db.document.update({ where: { id }, data: { status, errorMessage: errorMessage ?? null } });
  }

  async updateProcessedText(id: string, text: string): Promise<void> {
    await this.db.document.update({ where: { id }, data: { processedText: text, status: 'PROCESSING' } });
  }

  async updateTokenCount(id: string, tokenCount: number): Promise<void> {
    await this.db.document.update({ where: { id }, data: { tokenCount } });
  }

  async delete(id: string): Promise<void> {
    await this.db.document.delete({ where: { id } });
  }
}
```

- [ ] **Step 7: Create `document-chunk/interface.ts`**

```typescript
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

export interface CreateDocumentChunkInput {
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentChunkRepository {
  findById(id: string): Promise<DocumentChunkRecord | null>;
  findByDocumentId(docId: string, params?: PaginationParams): Promise<PaginatedResult<DocumentChunkRecord>>;
  findByKnowledgeBaseId(kbId: string, params?: PaginationParams & { documentId?: string }): Promise<PaginatedResult<DocumentChunkRecord>>;
  createMany(inputs: CreateDocumentChunkInput[]): Promise<number>;
  deleteByDocumentId(docId: string): Promise<number>;
  storeEmbedding(chunkId: string, embedding: number[]): Promise<void>;
  storeEmbeddingsBatch(pairs: Array<{ chunkId: string; embedding: number[] }>): Promise<void>;
  storeTsvector(chunkId: string, content: string): Promise<void>;
  storeTsvectorBatch(pairs: Array<{ chunkId: string; content: string }>): Promise<void>;
  getChunkIdsWithoutEmbedding(documentId: string): Promise<string[]>;
}
```

- [ ] **Step 8: Create `document-chunk/postgres.ts`**

```typescript
import type { DocumentChunkRepository, DocumentChunkRecord, CreateDocumentChunkInput } from './interface';
import type { PaginationParams, PaginatedResult } from '@chatbot/shared';

export class PostgresDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<DocumentChunkRecord | null> {
    return this.db.documentChunk.findUnique({ where: { id } });
  }

  async findByDocumentId(docId: string, params: PaginationParams = {}): Promise<PaginatedResult<DocumentChunkRecord>> {
    const { limit = 20, offset = 0 } = params;
    const [items, total] = await Promise.all([
      this.db.documentChunk.findMany({ where: { documentId: docId }, orderBy: { chunkIndex: 'asc' }, take: limit, skip: offset }),
      this.db.documentChunk.count({ where: { documentId: docId } }),
    ]);
    return { items, total, limit, offset };
  }

  async findByKnowledgeBaseId(kbId: string, params: PaginationParams & { documentId?: string } = {}): Promise<PaginatedResult<DocumentChunkRecord>> {
    const { limit = 20, offset = 0, documentId } = params;
    const where = { document: { dataSource: { knowledgeBaseId: kbId } }, ...(documentId ? { documentId } : {}) };
    const [items, total] = await Promise.all([
      this.db.documentChunk.findMany({ where, orderBy: { chunkIndex: 'asc' }, take: limit, skip: offset }),
      this.db.documentChunk.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async createMany(inputs: CreateDocumentChunkInput[]): Promise<number> {
    const result = await this.db.documentChunk.createMany({ data: inputs });
    return result.count;
  }

  async deleteByDocumentId(docId: string): Promise<number> {
    const result = await this.db.documentChunk.deleteMany({ where: { documentId: docId } });
    return result.count;
  }

  async storeEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.db.$executeRawUnsafe(
      `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
      vectorStr, chunkId,
    );
  }

  async storeEmbeddingsBatch(pairs: Array<{ chunkId: string; embedding: number[] }>): Promise<void> {
    for (const { chunkId, embedding } of pairs) {
      await this.storeEmbedding(chunkId, embedding);
    }
  }

  async storeTsvector(chunkId: string, content: string): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE document_chunks SET search_text = to_tsvector('english', $1) WHERE id = $2`,
      content, chunkId,
    );
  }

  async storeTsvectorBatch(pairs: Array<{ chunkId: string; content: string }>): Promise<void> {
    for (const { chunkId, content } of pairs) {
      await this.storeTsvector(chunkId, content);
    }
  }

  async getChunkIdsWithoutEmbedding(documentId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.db.$queryRawUnsafe(
      `SELECT id FROM document_chunks WHERE document_id = $1 AND embedding IS NULL ORDER BY chunk_index`,
      documentId,
    );
    return rows.map(r => r.id);
  }
}
```

- [ ] **Step 9: Create `repository-factory.ts`**

```typescript
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
```

- [ ] **Step 10: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { createKnowledgeBaseRepository, createDataSourceRepository, createDocumentRepository, createDocumentChunkRepository } from './db/repositories/repository-factory';
export type { KnowledgeBaseRepository, KnowledgeBaseRecord, CreateKnowledgeBaseInput as CreateKBRepoInput } from './db/repositories/knowledge-base/interface';
export type { DataSourceRepository, DataSourceRecord } from './db/repositories/data-source/interface';
export type { DocumentRepository, DocumentRecord } from './db/repositories/document/interface';
export type { DocumentChunkRepository, DocumentChunkRecord } from './db/repositories/document-chunk/interface';
```

- [ ] **Step 11: Verify build**

Run: `nx build knowledge-base`

- [ ] **Step 12: Commit**

```bash
git add libs/knowledge-base/src/db/
git commit -m "feat(knowledge-base): add repository layer with Prisma implementations

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 4: Document Parsers

**Files:**
- Create: `libs/knowledge-base/src/ingestion/parsers/pdf-parser.ts`
- Create: `libs/knowledge-base/src/ingestion/parsers/docx-parser.ts`
- Create: `libs/knowledge-base/src/ingestion/parsers/text-parser.ts`
- Create: `libs/knowledge-base/src/ingestion/parsers/html-parser.ts`
- Create: `libs/knowledge-base/src/ingestion/parsers/xlsx-parser.ts`
- Create: `libs/knowledge-base/src/ingestion/parsers/parser-factory.ts`
- Test: `libs/knowledge-base/src/ingestion/parsers/text-parser.test.ts`
- Test: `libs/knowledge-base/src/ingestion/parsers/html-parser.test.ts`
- Test: `libs/knowledge-base/src/ingestion/parsers/parser-factory.test.ts`

- [ ] **Step 1: Install parser dependencies**

Run: `bun add pdf-parse mammoth xlsx sanitize-html && bun add -D @types/pdf-parse @types/sanitize-html`

- [ ] **Step 2: Create `text-parser.ts`**

```typescript
import type { DocumentParser } from '../../types';

export class TextParser implements DocumentParser {
  async parse(buffer: Buffer, mimeType: string): Promise<string> {
    const text = buffer.toString('utf-8');
    if (mimeType === 'application/json') {
      const parsed = JSON.parse(text);
      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    }
    return text;
  }
}
```

- [ ] **Step 3: Write test for `text-parser.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { TextParser } from './text-parser';

describe('TextParser', () => {
  const parser = new TextParser();

  it('parses plain text', async () => {
    const buf = Buffer.from('Hello world');
    expect(await parser.parse(buf, 'text/plain')).toBe('Hello world');
  });

  it('parses markdown', async () => {
    const buf = Buffer.from('# Title\n\nParagraph');
    expect(await parser.parse(buf, 'text/markdown')).toBe('# Title\n\nParagraph');
  });

  it('parses JSON and pretty-prints objects', async () => {
    const buf = Buffer.from('{"key":"value"}');
    const result = await parser.parse(buf, 'application/json');
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });

  it('parses CSV as plain text', async () => {
    const buf = Buffer.from('a,b,c\n1,2,3');
    expect(await parser.parse(buf, 'text/csv')).toBe('a,b,c\n1,2,3');
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/parsers/text-parser.test.ts`
Expected: All tests pass

- [ ] **Step 5: Create `html-parser.ts`**

```typescript
import sanitizeHtml from 'sanitize-html';
import type { DocumentParser } from '../../types';

export class HtmlParser implements DocumentParser {
  async parse(buffer: Buffer): Promise<string> {
    const html = buffer.toString('utf-8');
    return sanitizeHtml(html, {
      allowedTags: [],
      allowedAttributes: {},
    }).replace(/\s+/g, ' ').trim();
  }
}
```

- [ ] **Step 6: Write test for `html-parser.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { HtmlParser } from './html-parser';

describe('HtmlParser', () => {
  const parser = new HtmlParser();

  it('strips HTML tags and returns text', async () => {
    const buf = Buffer.from('<h1>Title</h1><p>Paragraph with <b>bold</b></p>');
    const result = await parser.parse(buf, 'text/html');
    expect(result).toBe('Title Paragraph with bold');
  });

  it('handles empty HTML', async () => {
    const buf = Buffer.from('<div></div>');
    expect(await parser.parse(buf, 'text/html')).toBe('');
  });
});
```

- [ ] **Step 7: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/parsers/html-parser.test.ts`

- [ ] **Step 8: Create `pdf-parser.ts`**

```typescript
import pdfParse from 'pdf-parse';
import type { DocumentParser } from '../../types';

export class PdfParser implements DocumentParser {
  async parse(buffer: Buffer): Promise<string> {
    const result = await pdfParse(buffer);
    if (!result.text || result.text.trim().length < 50) {
      throw new Error('PDF_NEEDS_OCR');
    }
    return result.text;
  }
}
```

- [ ] **Step 9: Create `docx-parser.ts`**

```typescript
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import type { DocumentParser } from '../../types';

export class DocxParser implements DocumentParser {
  async parse(buffer: Buffer): Promise<string> {
    const result = await mammoth.convertToHtml({ buffer });
    return sanitizeHtml(result.value, {
      allowedTags: [],
      allowedAttributes: {},
    }).replace(/\s+/g, ' ').trim();
  }
}
```

- [ ] **Step 10: Create `xlsx-parser.ts`**

```typescript
import * as XLSX from 'xlsx';
import type { DocumentParser } from '../../types';

export class XlsxParser implements DocumentParser {
  async parse(buffer: Buffer): Promise<string> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`## ${name}\n\n${csv}`);
    }
    return sheets.join('\n\n');
  }
}
```

- [ ] **Step 11: Create `parser-factory.ts`**

```typescript
import type { DocumentParser } from '../../types';
import { PdfParser } from './pdf-parser';
import { DocxParser } from './docx-parser';
import { TextParser } from './text-parser';
import { HtmlParser } from './html-parser';
import { XlsxParser } from './xlsx-parser';

const MIME_MAP: Record<string, () => DocumentParser> = {
  'application/pdf': () => new PdfParser(),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': () => new DocxParser(),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': () => new XlsxParser(),
  'text/plain': () => new TextParser(),
  'text/markdown': () => new TextParser(),
  'text/csv': () => new TextParser(),
  'text/html': () => new HtmlParser(),
  'application/json': () => new TextParser(),
};

export function createParser(mimeType: string): DocumentParser {
  const factory = MIME_MAP[mimeType];
  if (!factory) throw new Error(`Unsupported MIME type: ${mimeType}`);
  return factory();
}
```

- [ ] **Step 12: Write test for `parser-factory.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createParser } from './parser-factory';
import { PdfParser } from './pdf-parser';
import { TextParser } from './text-parser';
import { HtmlParser } from './html-parser';

describe('createParser', () => {
  it('returns PdfParser for application/pdf', () => {
    expect(createParser('application/pdf')).toBeInstanceOf(PdfParser);
  });

  it('returns TextParser for text/plain', () => {
    expect(createParser('text/plain')).toBeInstanceOf(TextParser);
  });

  it('returns HtmlParser for text/html', () => {
    expect(createParser('text/html')).toBeInstanceOf(HtmlParser);
  });

  it('throws for unsupported MIME type', () => {
    expect(() => createParser('video/mp4')).toThrow('Unsupported MIME type');
  });
});
```

- [ ] **Step 13: Run all parser tests**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/parsers/`
Expected: All tests pass

- [ ] **Step 14: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { createParser } from './ingestion/parsers/parser-factory';
```

- [ ] **Step 15: Commit**

```bash
git add libs/knowledge-base/src/ingestion/parsers/ package.json bun.lock
git commit -m "feat(knowledge-base): add document parsers for PDF, DOCX, XLSX, HTML, text

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 5: Pre-processing Pipeline

**Files:**
- Create: `libs/knowledge-base/src/ingestion/pre-processing/html-stripper.ts`
- Create: `libs/knowledge-base/src/ingestion/pre-processing/pii-redactor.ts`
- Create: `libs/knowledge-base/src/ingestion/pre-processing/ocr-processor.ts`
- Create: `libs/knowledge-base/src/ingestion/pre-processing/table-extractor.ts`
- Create: `libs/knowledge-base/src/ingestion/pre-processing/pipeline.ts`
- Test: `libs/knowledge-base/src/ingestion/pre-processing/pii-redactor.test.ts`
- Test: `libs/knowledge-base/src/ingestion/pre-processing/pipeline.test.ts`

- [ ] **Step 1: Install Textract SDK**

Run: `bun add @aws-sdk/client-textract`

- [ ] **Step 2: Create `html-stripper.ts`**

```typescript
import sanitizeHtml from 'sanitize-html';

export function stripHtml(text: string): string {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 3: Create `pii-redactor.ts`**

```typescript
const DEFAULT_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone', regex: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit_card', regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
];

export function redactPii(text: string, customPatterns?: string[]): string {
  let result = text;
  const patterns = [...DEFAULT_PATTERNS];
  if (customPatterns) {
    for (const p of customPatterns) {
      patterns.push({ name: 'custom', regex: new RegExp(p, 'g') });
    }
  }
  for (const { regex } of patterns) {
    result = result.replace(regex, '[REDACTED]');
  }
  return result;
}
```

- [ ] **Step 4: Write test for `pii-redactor.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { redactPii } from './pii-redactor';

describe('redactPii', () => {
  it('redacts email addresses', () => {
    expect(redactPii('Contact john@example.com for info')).toBe('Contact [REDACTED] for info');
  });

  it('redacts phone numbers', () => {
    expect(redactPii('Call 555-123-4567')).toBe('Call [REDACTED]');
  });

  it('redacts SSNs', () => {
    expect(redactPii('SSN: 123-45-6789')).toBe('SSN: [REDACTED]');
  });

  it('redacts credit card numbers', () => {
    expect(redactPii('Card: 4111-1111-1111-1111')).toBe('Card: [REDACTED]');
  });

  it('applies custom patterns', () => {
    expect(redactPii('ID: ABC-123', ['ABC-\\d+'])).toBe('ID: [REDACTED]');
  });

  it('leaves clean text unchanged', () => {
    expect(redactPii('No PII here')).toBe('No PII here');
  });
});
```

- [ ] **Step 5: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/pre-processing/pii-redactor.test.ts`

- [ ] **Step 6: Create `ocr-processor.ts`**

```typescript
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { kbEnv } from '../../env';

let client: TextractClient | null = null;

function getClient(): TextractClient {
  if (!client) {
    client = new TextractClient({ region: kbEnv.AWS_REGION });
  }
  return client;
}

export async function extractTextWithOcr(buffer: Buffer): Promise<string> {
  const command = new DetectDocumentTextCommand({
    Document: { Bytes: buffer },
  });
  const response = await getClient().send(command);
  const lines = (response.Blocks ?? [])
    .filter(b => b.BlockType === 'LINE')
    .map(b => b.Text ?? '')
    .filter(Boolean);
  return lines.join('\n');
}
```

- [ ] **Step 7: Create `table-extractor.ts`**

```typescript
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { kbEnv } from '../../env';

let client: TextractClient | null = null;

function getClient(): TextractClient {
  if (!client) {
    client = new TextractClient({ region: kbEnv.AWS_REGION });
  }
  return client;
}

export async function extractTables(buffer: Buffer): Promise<string[]> {
  const command = new AnalyzeDocumentCommand({
    Document: { Bytes: buffer },
    FeatureTypes: ['TABLES'],
  });
  const response = await getClient().send(command);
  const blocks = response.Blocks ?? [];

  const blockMap = new Map(blocks.map(b => [b.Id, b]));
  const tables: string[] = [];

  for (const block of blocks) {
    if (block.BlockType !== 'TABLE') continue;
    const rows: Map<number, Map<number, string>> = new Map();

    for (const rel of block.Relationships ?? []) {
      if (rel.Type !== 'CHILD') continue;
      for (const cellId of rel.Ids ?? []) {
        const cell = blockMap.get(cellId);
        if (!cell || cell.BlockType !== 'CELL') continue;
        const row = cell.RowIndex ?? 0;
        const col = cell.ColumnIndex ?? 0;
        let cellText = '';
        for (const cellRel of cell.Relationships ?? []) {
          if (cellRel.Type !== 'CHILD') continue;
          for (const wordId of cellRel.Ids ?? []) {
            const word = blockMap.get(wordId);
            if (word?.BlockType === 'WORD') cellText += (word.Text ?? '') + ' ';
          }
        }
        if (!rows.has(row)) rows.set(row, new Map());
        rows.get(row)!.set(col, cellText.trim());
      }
    }

    const sortedRows = [...rows.entries()].sort(([a], [b]) => a - b);
    const mdRows: string[] = [];
    for (const [i, [, cols]] of sortedRows.entries()) {
      const sortedCols = [...cols.entries()].sort(([a], [b]) => a - b);
      const line = '| ' + sortedCols.map(([, v]) => v).join(' | ') + ' |';
      mdRows.push(line);
      if (i === 0) {
        mdRows.push('| ' + sortedCols.map(() => '---').join(' | ') + ' |');
      }
    }
    tables.push(mdRows.join('\n'));
  }

  return tables;
}
```

- [ ] **Step 8: Create `pipeline.ts`**

```typescript
import type { PreProcessingConfig } from '../../types';
import { stripHtml } from './html-stripper';
import { redactPii } from './pii-redactor';
import { extractTextWithOcr } from './ocr-processor';
import { extractTables } from './table-extractor';

export interface PreProcessingResult {
  text: string;
  tables: string[];
  usedOcr: boolean;
}

export async function runPreProcessing(
  text: string,
  rawBuffer: Buffer | null,
  config: PreProcessingConfig,
): Promise<PreProcessingResult> {
  let processed = text;
  const tables: string[] = [];
  let usedOcr = false;

  if (config.htmlStripping) {
    processed = stripHtml(processed);
  }

  if (config.ocrEnabled && rawBuffer && processed.trim().length < 50) {
    processed = await extractTextWithOcr(rawBuffer);
    usedOcr = true;
  }

  if (config.tableExtraction && rawBuffer) {
    try {
      const extracted = await extractTables(rawBuffer);
      tables.push(...extracted);
    } catch {
      // Table extraction is best-effort
    }
  }

  if (config.piiRedaction) {
    processed = redactPii(processed, config.piiPatterns);
  }

  return { text: processed, tables, usedOcr };
}
```

- [ ] **Step 9: Write test for `pipeline.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runPreProcessing } from './pipeline';

vi.mock('./ocr-processor', () => ({
  extractTextWithOcr: vi.fn().mockResolvedValue('OCR extracted text'),
}));

vi.mock('./table-extractor', () => ({
  extractTables: vi.fn().mockResolvedValue(['| A | B |\n| --- | --- |\n| 1 | 2 |']),
}));

describe('runPreProcessing', () => {
  it('strips HTML when enabled', async () => {
    const result = await runPreProcessing('<p>Hello</p>', null, {
      htmlStripping: true, piiRedaction: false, ocrEnabled: false, tableExtraction: false,
    });
    expect(result.text).toBe('Hello');
  });

  it('redacts PII when enabled', async () => {
    const result = await runPreProcessing('Email: test@example.com', null, {
      htmlStripping: false, piiRedaction: true, ocrEnabled: false, tableExtraction: false,
    });
    expect(result.text).toBe('Email: [REDACTED]');
  });

  it('falls back to OCR when text is too short', async () => {
    const result = await runPreProcessing('', Buffer.from('fake-pdf'), {
      htmlStripping: false, piiRedaction: false, ocrEnabled: true, tableExtraction: false,
    });
    expect(result.text).toBe('OCR extracted text');
    expect(result.usedOcr).toBe(true);
  });

  it('extracts tables when enabled', async () => {
    const result = await runPreProcessing('Some text', Buffer.from('fake'), {
      htmlStripping: false, piiRedaction: false, ocrEnabled: false, tableExtraction: true,
    });
    expect(result.tables).toHaveLength(1);
  });
});
```

- [ ] **Step 10: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/pre-processing/`

- [ ] **Step 11: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { runPreProcessing } from './ingestion/pre-processing/pipeline';
export { redactPii } from './ingestion/pre-processing/pii-redactor';
```

- [ ] **Step 12: Commit**

```bash
git add libs/knowledge-base/src/ingestion/pre-processing/ package.json bun.lock
git commit -m "feat(knowledge-base): add pre-processing pipeline (HTML strip, PII, OCR, tables)

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 6: Chunking Strategies

**Files:**
- Create: `libs/knowledge-base/src/ingestion/chunking/fixed-size.ts`
- Create: `libs/knowledge-base/src/ingestion/chunking/recursive-character.ts`
- Create: `libs/knowledge-base/src/ingestion/chunking/semantic.ts`
- Create: `libs/knowledge-base/src/ingestion/chunking/markdown-aware.ts`
- Create: `libs/knowledge-base/src/ingestion/chunking/code-aware.ts`
- Create: `libs/knowledge-base/src/ingestion/chunking/chunker-factory.ts`
- Test: `libs/knowledge-base/src/ingestion/chunking/fixed-size.test.ts`
- Test: `libs/knowledge-base/src/ingestion/chunking/recursive-character.test.ts`
- Test: `libs/knowledge-base/src/ingestion/chunking/markdown-aware.test.ts`
- Test: `libs/knowledge-base/src/ingestion/chunking/chunker-factory.test.ts`

- [ ] **Step 1: Create `fixed-size.ts`**

```typescript
import type { Chunker, ChunkResult } from '../../types';

export class FixedSizeChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    const results: ChunkResult[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end);
      results.push({
        content,
        metadata: { chunkStrategy: 'FIXED_SIZE', charStart: start, charEnd: end },
        tokenCount: Math.ceil(content.length / 4),
      });
      if (end >= text.length) break;
      start = end - chunkOverlap;
    }
    return results;
  }
}
```

- [ ] **Step 2: Write test for `fixed-size.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { FixedSizeChunker } from './fixed-size';

describe('FixedSizeChunker', () => {
  const chunker = new FixedSizeChunker();

  it('splits text into fixed-size chunks', () => {
    const text = 'a'.repeat(100);
    const chunks = chunker.chunk(text, 30, 5);
    expect(chunks.length).toBe(4);
    expect(chunks[0].content.length).toBe(30);
  });

  it('handles overlap correctly', () => {
    const text = 'abcdefghij';
    const chunks = chunker.chunk(text, 5, 2);
    expect(chunks[0].content).toBe('abcde');
    expect(chunks[1].content).toBe('defgh');
  });

  it('handles text shorter than chunk size', () => {
    const chunks = chunker.chunk('short', 100, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('short');
  });

  it('estimates token count', () => {
    const chunks = chunker.chunk('a'.repeat(100), 100, 0);
    expect(chunks[0].tokenCount).toBe(25);
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/chunking/fixed-size.test.ts`

- [ ] **Step 4: Create `recursive-character.ts`**

```typescript
import type { Chunker, ChunkResult } from '../../types';

const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

export class RecursiveCharacterChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    return this.splitText(text, chunkSize, chunkOverlap, SEPARATORS);
  }

  private splitText(text: string, chunkSize: number, overlap: number, separators: string[]): ChunkResult[] {
    if (text.length <= chunkSize) {
      return [{ content: text, metadata: { chunkStrategy: 'RECURSIVE_CHARACTER' }, tokenCount: Math.ceil(text.length / 4) }];
    }

    const sep = separators.find(s => text.includes(s)) ?? '';
    const parts = sep ? text.split(sep) : [text];
    const results: ChunkResult[] = [];
    let current = '';

    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (candidate.length > chunkSize && current) {
        results.push({
          content: current,
          metadata: { chunkStrategy: 'RECURSIVE_CHARACTER' },
          tokenCount: Math.ceil(current.length / 4),
        });
        const overlapText = current.slice(-overlap);
        current = overlapText + sep + part;
      } else {
        current = candidate;
      }
    }

    if (current) {
      if (current.length > chunkSize && separators.length > 1) {
        results.push(...this.splitText(current, chunkSize, overlap, separators.slice(1)));
      } else {
        results.push({
          content: current,
          metadata: { chunkStrategy: 'RECURSIVE_CHARACTER' },
          tokenCount: Math.ceil(current.length / 4),
        });
      }
    }

    return results;
  }
}
```

- [ ] **Step 5: Write test for `recursive-character.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { RecursiveCharacterChunker } from './recursive-character';

describe('RecursiveCharacterChunker', () => {
  const chunker = new RecursiveCharacterChunker();

  it('splits on paragraph boundaries first', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = chunker.chunk(text, 30, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain('Paragraph one');
  });

  it('falls back to sentence boundaries', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const chunks = chunker.chunk(text, 25, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('returns single chunk for short text', () => {
    const chunks = chunker.chunk('Short text', 100, 0);
    expect(chunks).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/chunking/recursive-character.test.ts`

- [ ] **Step 7: Create `semantic.ts`**

```typescript
import type { Chunker, ChunkResult } from '../../types';

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z])/;

export class SemanticChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    const sentences = text.split(SENTENCE_BOUNDARY).filter(s => s.trim());
    const results: ChunkResult[] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const sentence of sentences) {
      if (currentLen + sentence.length > chunkSize && current.length > 0) {
        const content = current.join(' ');
        results.push({
          content,
          metadata: { chunkStrategy: 'SEMANTIC', sentenceCount: current.length },
          tokenCount: Math.ceil(content.length / 4),
        });
        const overlapSentences = Math.max(1, Math.floor(current.length * (chunkOverlap / chunkSize)));
        current = current.slice(-overlapSentences);
        currentLen = current.join(' ').length;
      }
      current.push(sentence);
      currentLen += sentence.length;
    }

    if (current.length > 0) {
      const content = current.join(' ');
      results.push({
        content,
        metadata: { chunkStrategy: 'SEMANTIC', sentenceCount: current.length },
        tokenCount: Math.ceil(content.length / 4),
      });
    }

    return results;
  }
}
```

- [ ] **Step 8: Create `markdown-aware.ts`**

```typescript
import type { Chunker, ChunkResult } from '../../types';

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/gm;

interface Section {
  headingPath: string[];
  content: string;
  level: number;
}

export class MarkdownAwareChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    const sections = this.parseSections(text);
    const results: ChunkResult[] = [];

    for (const section of sections) {
      if (section.content.length <= chunkSize) {
        results.push({
          content: section.content,
          metadata: {
            chunkStrategy: 'MARKDOWN_AWARE',
            headingPath: section.headingPath,
            headingLevel: section.level,
          },
          tokenCount: Math.ceil(section.content.length / 4),
        });
      } else {
        const subChunks = this.splitLongSection(section, chunkSize, chunkOverlap);
        results.push(...subChunks);
      }
    }

    return results;
  }

  private parseSections(text: string): Section[] {
    const lines = text.split('\n');
    const sections: Section[] = [];
    const headingStack: string[] = [];
    let currentContent: string[] = [];
    let currentLevel = 0;

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        if (currentContent.length > 0) {
          sections.push({
            headingPath: [...headingStack],
            content: currentContent.join('\n').trim(),
            level: currentLevel,
          });
          currentContent = [];
        }
        const level = match[1].length;
        while (headingStack.length >= level) headingStack.pop();
        headingStack.push(match[2]);
        currentLevel = level;
      }
      currentContent.push(line);
    }

    if (currentContent.length > 0) {
      sections.push({
        headingPath: [...headingStack],
        content: currentContent.join('\n').trim(),
        level: currentLevel,
      });
    }

    return sections;
  }

  private splitLongSection(section: Section, chunkSize: number, overlap: number): ChunkResult[] {
    const paragraphs = section.content.split('\n\n');
    const results: ChunkResult[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length > chunkSize && current) {
        results.push({
          content: current.trim(),
          metadata: {
            chunkStrategy: 'MARKDOWN_AWARE',
            headingPath: section.headingPath,
            headingLevel: section.level,
          },
          tokenCount: Math.ceil(current.trim().length / 4),
        });
        current = current.slice(-overlap) + '\n\n' + para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }

    if (current.trim()) {
      results.push({
        content: current.trim(),
        metadata: {
          chunkStrategy: 'MARKDOWN_AWARE',
          headingPath: section.headingPath,
          headingLevel: section.level,
        },
        tokenCount: Math.ceil(current.trim().length / 4),
      });
    }

    return results;
  }
}
```

- [ ] **Step 9: Write test for `markdown-aware.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { MarkdownAwareChunker } from './markdown-aware';

describe('MarkdownAwareChunker', () => {
  const chunker = new MarkdownAwareChunker();

  it('splits by headings', () => {
    const text = '# Title\n\nIntro paragraph.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.';
    const chunks = chunker.chunk(text, 500, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves heading path in metadata', () => {
    const text = '# Title\n\n## Sub\n\nContent here.';
    const chunks = chunker.chunk(text, 500, 0);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.metadata.headingPath).toContain('Sub');
  });

  it('splits long sections into sub-chunks', () => {
    const text = '# Title\n\n' + 'Long paragraph. '.repeat(100);
    const chunks = chunker.chunk(text, 200, 0);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 10: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/chunking/markdown-aware.test.ts`

- [ ] **Step 11: Create `code-aware.ts`**

```typescript
import type { Chunker, ChunkResult } from '../../types';

const CODE_BLOCK_REGEX = /^((?:export\s+)?(?:function|class|interface|type|const|let|var|enum|async\s+function)\s+\w+)/gm;

export class CodeAwareChunker implements Chunker {
  chunk(text: string, chunkSize: number, chunkOverlap: number): ChunkResult[] {
    const blocks = this.splitByDeclarations(text);
    const results: ChunkResult[] = [];
    let current = '';

    for (const block of blocks) {
      if (current.length + block.length > chunkSize && current) {
        results.push({
          content: current.trim(),
          metadata: { chunkStrategy: 'CODE_AWARE' },
          tokenCount: Math.ceil(current.trim().length / 4),
        });
        current = current.slice(-chunkOverlap) + '\n' + block;
      } else {
        current = current ? current + '\n' + block : block;
      }
    }

    if (current.trim()) {
      results.push({
        content: current.trim(),
        metadata: { chunkStrategy: 'CODE_AWARE' },
        tokenCount: Math.ceil(current.trim().length / 4),
      });
    }

    return results;
  }

  private splitByDeclarations(text: string): string[] {
    const lines = text.split('\n');
    const blocks: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
      if (CODE_BLOCK_REGEX.test(line) && current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
        CODE_BLOCK_REGEX.lastIndex = 0;
      }
      current.push(line);
      CODE_BLOCK_REGEX.lastIndex = 0;
    }

    if (current.length > 0) blocks.push(current.join('\n'));
    return blocks;
  }
}
```

- [ ] **Step 12: Create `chunker-factory.ts`**

```typescript
import type { Chunker, ChunkStrategy } from '../../types';
import { FixedSizeChunker } from './fixed-size';
import { RecursiveCharacterChunker } from './recursive-character';
import { SemanticChunker } from './semantic';
import { MarkdownAwareChunker } from './markdown-aware';
import { CodeAwareChunker } from './code-aware';

const CHUNKERS: Record<ChunkStrategy, () => Chunker> = {
  FIXED_SIZE: () => new FixedSizeChunker(),
  RECURSIVE_CHARACTER: () => new RecursiveCharacterChunker(),
  SEMANTIC: () => new SemanticChunker(),
  MARKDOWN_AWARE: () => new MarkdownAwareChunker(),
  CODE_AWARE: () => new CodeAwareChunker(),
};

export function createChunker(strategy: ChunkStrategy): Chunker {
  const factory = CHUNKERS[strategy];
  if (!factory) throw new Error(`Unknown chunk strategy: ${strategy}`);
  return factory();
}
```

- [ ] **Step 13: Write test for `chunker-factory.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createChunker } from './chunker-factory';
import { FixedSizeChunker } from './fixed-size';
import { RecursiveCharacterChunker } from './recursive-character';
import { MarkdownAwareChunker } from './markdown-aware';

describe('createChunker', () => {
  it('returns FixedSizeChunker', () => {
    expect(createChunker('FIXED_SIZE')).toBeInstanceOf(FixedSizeChunker);
  });

  it('returns RecursiveCharacterChunker', () => {
    expect(createChunker('RECURSIVE_CHARACTER')).toBeInstanceOf(RecursiveCharacterChunker);
  });

  it('returns MarkdownAwareChunker', () => {
    expect(createChunker('MARKDOWN_AWARE')).toBeInstanceOf(MarkdownAwareChunker);
  });

  it('throws for unknown strategy', () => {
    expect(() => createChunker('UNKNOWN' as any)).toThrow('Unknown chunk strategy');
  });
});
```

- [ ] **Step 14: Run all chunking tests**

Run: `cd libs/knowledge-base && bunx vitest run src/ingestion/chunking/`
Expected: All tests pass

- [ ] **Step 15: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { createChunker } from './ingestion/chunking/chunker-factory';
```

- [ ] **Step 16: Commit**

```bash
git add libs/knowledge-base/src/ingestion/chunking/
git commit -m "feat(knowledge-base): add 5 chunking strategies with factory

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 7: Embedding Providers

**Files:**
- Create: `libs/knowledge-base/src/embeddings/provider.ts`
- Create: `libs/knowledge-base/src/embeddings/bedrock-titan.ts`
- Create: `libs/knowledge-base/src/embeddings/openai.ts`
- Create: `libs/knowledge-base/src/embeddings/cohere.ts`
- Create: `libs/knowledge-base/src/embeddings/local-ollama.ts`
- Create: `libs/knowledge-base/src/embeddings/provider-factory.ts`
- Test: `libs/knowledge-base/src/embeddings/provider-factory.test.ts`
- Test: `libs/knowledge-base/src/embeddings/bedrock-titan.test.ts`

- [ ] **Step 1: Install embedding dependencies**

Run: `bun add openai cohere-ai`

- [ ] **Step 2: Create `provider.ts`** (re-export interface from types for convenience)

```typescript
export type { EmbeddingProvider } from '../types';
```

- [ ] **Step 3: Create `bedrock-titan.ts`**

```typescript
import { getBedrockProvider } from '@chatbot/ai';
import { embedMany, embed } from 'ai';
import type { EmbeddingProvider } from '../types';

export class BedrockTitanProvider implements EmbeddingProvider {
  readonly provider = 'BEDROCK_TITAN';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 25;

  constructor(model = 'amazon.titan-embed-text-v2:0', dimensions = 1024) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const bedrock = getBedrockProvider();
    const { embedding } = await embed({
      model: bedrock.textEmbeddingModel(this.model),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const bedrock = getBedrockProvider();
    const { embeddings } = await embedMany({
      model: bedrock.textEmbeddingModel(this.model),
      values: texts,
    });
    return embeddings;
  }
}
```

- [ ] **Step 4: Create `openai.ts`**

```typescript
import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'OPENAI';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 100;
  private client: OpenAI;

  constructor(model = 'text-embedding-3-small', dimensions = 1536) {
    this.model = model;
    this.dimensions = dimensions;
    this.client = new OpenAI();
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}
```

- [ ] **Step 5: Create `cohere.ts`**

```typescript
import { CohereClient } from 'cohere-ai';
import type { EmbeddingProvider } from '../types';

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'COHERE';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 96;
  private client: CohereClient;

  constructor(model = 'embed-english-v3.0', dimensions = 1024) {
    this.model = model;
    this.dimensions = dimensions;
    this.client = new CohereClient();
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({
      texts: [text],
      model: this.model,
      inputType: 'search_document',
    });
    const embeddings = response.embeddings;
    if (Array.isArray(embeddings) && Array.isArray(embeddings[0])) {
      return embeddings[0] as number[];
    }
    throw new Error('Unexpected Cohere embedding response format');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embed({
      texts,
      model: this.model,
      inputType: 'search_document',
    });
    const embeddings = response.embeddings;
    if (Array.isArray(embeddings) && Array.isArray(embeddings[0])) {
      return embeddings as number[][];
    }
    throw new Error('Unexpected Cohere embedding response format');
  }
}
```

- [ ] **Step 6: Create `local-ollama.ts`**

```typescript
import type { EmbeddingProvider } from '../types';
import { kbEnv } from '../env';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'LOCAL';
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 32;
  private baseUrl: string;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = kbEnv.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
```

- [ ] **Step 7: Create `provider-factory.ts`**

```typescript
import type { EmbeddingProvider, EmbeddingProviderType } from '../types';
import { BedrockTitanProvider } from './bedrock-titan';
import { OpenAIEmbeddingProvider } from './openai';
import { CohereEmbeddingProvider } from './cohere';
import { OllamaEmbeddingProvider } from './local-ollama';

interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  model: string;
  dimensions: number;
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'BEDROCK_TITAN':
      return new BedrockTitanProvider(config.model, config.dimensions);
    case 'OPENAI':
      return new OpenAIEmbeddingProvider(config.model, config.dimensions);
    case 'COHERE':
      return new CohereEmbeddingProvider(config.model, config.dimensions);
    case 'LOCAL':
      return new OllamaEmbeddingProvider(config.model, config.dimensions);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
```

- [ ] **Step 8: Write test for `provider-factory.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createEmbeddingProvider } from './provider-factory';
import { BedrockTitanProvider } from './bedrock-titan';
import { OpenAIEmbeddingProvider } from './openai';
import { CohereEmbeddingProvider } from './cohere';
import { OllamaEmbeddingProvider } from './local-ollama';

describe('createEmbeddingProvider', () => {
  it('creates BedrockTitanProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'BEDROCK_TITAN', model: 'amazon.titan-embed-text-v2:0', dimensions: 1024 });
    expect(provider).toBeInstanceOf(BedrockTitanProvider);
    expect(provider.dimensions).toBe(1024);
  });

  it('creates OpenAIEmbeddingProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'OPENAI', model: 'text-embedding-3-small', dimensions: 1536 });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it('creates CohereEmbeddingProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'COHERE', model: 'embed-english-v3.0', dimensions: 1024 });
    expect(provider).toBeInstanceOf(CohereEmbeddingProvider);
  });

  it('creates OllamaEmbeddingProvider', () => {
    const provider = createEmbeddingProvider({ provider: 'LOCAL', model: 'nomic-embed-text', dimensions: 768 });
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('throws for unknown provider', () => {
    expect(() => createEmbeddingProvider({ provider: 'UNKNOWN' as any, model: 'x', dimensions: 1 })).toThrow('Unknown embedding provider');
  });
});
```

- [ ] **Step 9: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/embeddings/`

- [ ] **Step 10: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { createEmbeddingProvider } from './embeddings/provider-factory';
export { BedrockTitanProvider } from './embeddings/bedrock-titan';
export { OpenAIEmbeddingProvider } from './embeddings/openai';
export { CohereEmbeddingProvider } from './embeddings/cohere';
export { OllamaEmbeddingProvider } from './embeddings/local-ollama';
```

- [ ] **Step 11: Commit**

```bash
git add libs/knowledge-base/src/embeddings/ package.json bun.lock
git commit -m "feat(knowledge-base): add multi-provider embedding abstraction

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 8: Retrieval System — Search

**Files:**
- Create: `libs/knowledge-base/src/retrieval/search/dense-search.ts`
- Create: `libs/knowledge-base/src/retrieval/search/sparse-search.ts`
- Create: `libs/knowledge-base/src/retrieval/search/hybrid-search.ts`
- Test: `libs/knowledge-base/src/retrieval/search/hybrid-search.test.ts`

- [ ] **Step 1: Create `dense-search.ts`**

```typescript
import type { EmbeddingProvider, RetrievalResult, MetadataFilter } from '../../types';

interface DenseSearchParams {
  knowledgeBaseId: string;
  query: string;
  topK: number;
  similarityThreshold: number;
  metadataFilters?: MetadataFilter[];
  embeddingProvider: EmbeddingProvider;
  db: any;
}

export async function denseSearch(params: DenseSearchParams): Promise<Array<RetrievalResult & { denseScore: number }>> {
  const { knowledgeBaseId, query, topK, similarityThreshold, metadataFilters, embeddingProvider, db } = params;
  const queryEmbedding = await embeddingProvider.embed(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  let filterClause = '';
  const filterValues: unknown[] = [vectorStr, knowledgeBaseId, similarityThreshold, topK];
  let paramIdx = 5;

  if (metadataFilters?.length) {
    const conditions = metadataFilters.map(f => {
      const placeholder = `$${paramIdx++}`;
      filterValues.push(f.value);
      switch (f.operator) {
        case 'eq': return `dc.metadata->>'${f.field}' = ${placeholder}`;
        case 'neq': return `dc.metadata->>'${f.field}' != ${placeholder}`;
        case 'contains': return `dc.metadata->>'${f.field}' ILIKE '%' || ${placeholder} || '%'`;
        default: return `dc.metadata->>'${f.field}' = ${placeholder}`;
      }
    });
    filterClause = 'AND ' + conditions.join(' AND ');
  }

  const rows: Array<{
    id: string; content: string; metadata: any; document_id: string;
    file_name: string; similarity: number;
  }> = await db.$queryRawUnsafe(`
    SELECT dc.id, dc.content, dc.metadata, dc.document_id,
           d.file_name, 1 - (dc.embedding <=> $1::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    JOIN data_sources ds ON ds.id = d.data_source_id
    WHERE ds.knowledge_base_id = $2
      AND 1 - (dc.embedding <=> $1::vector) >= $3
      ${filterClause}
    ORDER BY dc.embedding <=> $1::vector
    LIMIT $4
  `, ...filterValues);

  return rows.map(r => ({
    chunkId: r.id,
    content: r.content,
    score: r.similarity,
    denseScore: r.similarity,
    metadata: r.metadata ?? {},
    documentId: r.document_id,
    documentName: r.file_name,
  }));
}
```

- [ ] **Step 2: Create `sparse-search.ts`**

```typescript
import type { RetrievalResult, MetadataFilter } from '../../types';

interface SparseSearchParams {
  knowledgeBaseId: string;
  query: string;
  topK: number;
  metadataFilters?: MetadataFilter[];
  db: any;
}

export async function sparseSearch(params: SparseSearchParams): Promise<Array<RetrievalResult & { sparseScore: number }>> {
  const { knowledgeBaseId, query, topK, db } = params;

  const rows: Array<{
    id: string; content: string; metadata: any; document_id: string;
    file_name: string; rank: number;
  }> = await db.$queryRawUnsafe(`
    SELECT dc.id, dc.content, dc.metadata, dc.document_id,
           d.file_name, ts_rank_cd(dc.search_text, plainto_tsquery('english', $1)) AS rank
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    JOIN data_sources ds ON ds.id = d.data_source_id
    WHERE ds.knowledge_base_id = $2
      AND dc.search_text @@ plainto_tsquery('english', $1)
    ORDER BY rank DESC
    LIMIT $3
  `, query, knowledgeBaseId, topK);

  return rows.map(r => ({
    chunkId: r.id,
    content: r.content,
    score: r.rank,
    sparseScore: r.rank,
    metadata: r.metadata ?? {},
    documentId: r.document_id,
    documentName: r.file_name,
  }));
}
```

- [ ] **Step 3: Create `hybrid-search.ts`**

```typescript
import type { EmbeddingProvider, RetrievalResult, MetadataFilter } from '../../types';
import { denseSearch } from './dense-search';
import { sparseSearch } from './sparse-search';

const RRF_K = 60;

interface HybridSearchParams {
  knowledgeBaseId: string;
  query: string;
  topK: number;
  similarityThreshold: number;
  hybridAlpha: number;
  metadataFilters?: MetadataFilter[];
  embeddingProvider: EmbeddingProvider;
  db: any;
}

interface RankedResult extends RetrievalResult {
  denseScore?: number;
  sparseScore?: number;
  rrfScore: number;
}

export async function hybridSearch(params: HybridSearchParams): Promise<RankedResult[]> {
  const { topK, hybridAlpha } = params;
  const fetchK = topK * 3;

  const [denseResults, sparseResults] = await Promise.all([
    denseSearch({ ...params, topK: fetchK }),
    sparseSearch({ ...params, topK: fetchK }),
  ]);

  const scoreMap = new Map<string, RankedResult>();

  for (let i = 0; i < denseResults.length; i++) {
    const r = denseResults[i];
    const rrfDense = hybridAlpha * (1 / (RRF_K + i + 1));
    scoreMap.set(r.chunkId, {
      ...r,
      denseScore: r.denseScore,
      rrfScore: rrfDense,
    });
  }

  for (let i = 0; i < sparseResults.length; i++) {
    const r = sparseResults[i];
    const rrfSparse = (1 - hybridAlpha) * (1 / (RRF_K + i + 1));
    const existing = scoreMap.get(r.chunkId);
    if (existing) {
      existing.sparseScore = r.sparseScore;
      existing.rrfScore += rrfSparse;
    } else {
      scoreMap.set(r.chunkId, {
        ...r,
        sparseScore: r.sparseScore,
        rrfScore: rrfSparse,
      });
    }
  }

  return [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK)
    .map(r => ({ ...r, score: r.rrfScore }));
}
```

- [ ] **Step 4: Write test for `hybrid-search.ts`** (unit test with mocked dense/sparse)

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./dense-search', () => ({
  denseSearch: vi.fn().mockResolvedValue([
    { chunkId: 'a', content: 'A', score: 0.9, denseScore: 0.9, metadata: {}, documentId: 'd1', documentName: 'doc1' },
    { chunkId: 'b', content: 'B', score: 0.8, denseScore: 0.8, metadata: {}, documentId: 'd1', documentName: 'doc1' },
    { chunkId: 'c', content: 'C', score: 0.7, denseScore: 0.7, metadata: {}, documentId: 'd2', documentName: 'doc2' },
  ]),
}));

vi.mock('./sparse-search', () => ({
  sparseSearch: vi.fn().mockResolvedValue([
    { chunkId: 'b', content: 'B', score: 3.5, sparseScore: 3.5, metadata: {}, documentId: 'd1', documentName: 'doc1' },
    { chunkId: 'd', content: 'D', score: 2.1, sparseScore: 2.1, metadata: {}, documentId: 'd2', documentName: 'doc2' },
    { chunkId: 'a', content: 'A', score: 1.0, sparseScore: 1.0, metadata: {}, documentId: 'd1', documentName: 'doc1' },
  ]),
}));

import { hybridSearch } from './hybrid-search';

describe('hybridSearch', () => {
  const mockParams = {
    knowledgeBaseId: 'kb1',
    query: 'test query',
    topK: 3,
    similarityThreshold: 0.5,
    hybridAlpha: 0.7,
    embeddingProvider: {} as any,
    db: {} as any,
  };

  it('merges dense and sparse results via RRF', async () => {
    const results = await hybridSearch(mockParams);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0].rrfScore).toBeGreaterThan(0);
  });

  it('includes results from both dense and sparse', async () => {
    const results = await hybridSearch(mockParams);
    const ids = results.map(r => r.chunkId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('chunk b gets boosted by appearing in both lists', async () => {
    const results = await hybridSearch(mockParams);
    const a = results.find(r => r.chunkId === 'a')!;
    const b = results.find(r => r.chunkId === 'b')!;
    expect(b.rrfScore).toBeGreaterThan(a.rrfScore);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/retrieval/search/`

- [ ] **Step 6: Commit**

```bash
git add libs/knowledge-base/src/retrieval/search/
git commit -m "feat(knowledge-base): add dense, sparse, and hybrid search

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

### Task 9: Retrieval System — Reranking & Compression

**Files:**
- Create: `libs/knowledge-base/src/retrieval/reranking/cohere-reranker.ts`
- Create: `libs/knowledge-base/src/retrieval/reranking/cross-encoder-reranker.ts`
- Create: `libs/knowledge-base/src/retrieval/reranking/reranker-factory.ts`
- Create: `libs/knowledge-base/src/retrieval/compression/contextual-compressor.ts`
- Test: `libs/knowledge-base/src/retrieval/reranking/reranker-factory.test.ts`

- [ ] **Step 1: Create `cohere-reranker.ts`**

```typescript
import { CohereClient } from 'cohere-ai';
import type { Reranker, RetrievalResult } from '../../types';

export class CohereReranker implements Reranker {
  private client: CohereClient;
  private model: string;

  constructor(model = 'rerank-english-v3.0') {
    this.client = new CohereClient();
    this.model = model;
  }

  async rerank(query: string, chunks: RetrievalResult[], topK: number): Promise<RetrievalResult[]> {
    const response = await this.client.rerank({
      query,
      documents: chunks.map(c => c.content),
      model: this.model,
      topN: topK,
    });

    return response.results.map(r => ({
      ...chunks[r.index],
      score: r.relevanceScore,
      rerankScore: r.relevanceScore,
    }));
  }
}
```

- [ ] **Step 2: Create `cross-encoder-reranker.ts`**

```typescript
import type { Reranker, RetrievalResult } from '../../types';
import { kbEnv } from '../../env';

export class CrossEncoderReranker implements Reranker {
  private baseUrl: string;
  private model: string;

  constructor(model = 'cross-encoder') {
    this.baseUrl = kbEnv.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = model;
  }

  async rerank(query: string, chunks: RetrievalResult[], topK: number): Promise<RetrievalResult[]> {
    const scored = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: `Query: ${query}\nDocument: ${chunk.content}\nRelevance:`,
          }),
        });
        if (!response.ok) return { ...chunk, rerankScore: chunk.score };
        const data = await response.json();
        const score = Array.isArray(data.embedding) ? data.embedding[0] : chunk.score;
        return { ...chunk, rerankScore: score };
      }),
    );

    return scored
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      .slice(0, topK)
      .map(r => ({ ...r, score: r.rerankScore ?? r.score }));
  }
}
```

- [ ] **Step 3: Create `reranker-factory.ts`**

```typescript
import type { Reranker, RerankProvider } from '../../types';
import { CohereReranker } from './cohere-reranker';
import { CrossEncoderReranker } from './cross-encoder-reranker';

export function createReranker(provider: RerankProvider): Reranker | null {
  switch (provider) {
    case 'COHERE': return new CohereReranker();
    case 'CROSS_ENCODER': return new CrossEncoderReranker();
    case 'NONE': return null;
    default: return null;
  }
}
```

- [ ] **Step 4: Write test for `reranker-factory.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createReranker } from './reranker-factory';
import { CohereReranker } from './cohere-reranker';
import { CrossEncoderReranker } from './cross-encoder-reranker';

describe('createReranker', () => {
  it('creates CohereReranker', () => {
    expect(createReranker('COHERE')).toBeInstanceOf(CohereReranker);
  });

  it('creates CrossEncoderReranker', () => {
    expect(createReranker('CROSS_ENCODER')).toBeInstanceOf(CrossEncoderReranker);
  });

  it('returns null for NONE', () => {
    expect(createReranker('NONE')).toBeNull();
  });
});
```

- [ ] **Step 5: Create `contextual-compressor.ts`**

```typescript
import type { RetrievalResult } from '../../types';
import { getBedrockProvider } from '@chatbot/ai';
import { generateText } from 'ai';

const COMPRESSION_PROMPT = `Given the query and document chunk below, determine if the chunk is relevant.
If relevant, extract ONLY the sentences that directly answer or relate to the query.
If not relevant, respond with exactly "NOT_RELEVANT".

Query: {query}

Chunk:
{chunk}

Relevant extract:`;

export async function compressResults(
  query: string,
  results: RetrievalResult[],
  model = 'anthropic.claude-sonnet-4-20250514',
): Promise<RetrievalResult[]> {
  const bedrock = getBedrockProvider();
  const compressed: RetrievalResult[] = [];

  for (const result of results) {
    const prompt = COMPRESSION_PROMPT
      .replace('{query}', query)
      .replace('{chunk}', result.content);

    const { text } = await generateText({
      model: bedrock(model),
      prompt,
      maxTokens: 500,
    });

    if (text.trim() !== 'NOT_RELEVANT') {
      compressed.push({
        ...result,
        content: text.trim(),
        compressionKept: true,
      } as any);
    }
  }

  return compressed;
}
```

- [ ] **Step 6: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/retrieval/reranking/`

- [ ] **Step 7: Commit**

```bash
git add libs/knowledge-base/src/retrieval/reranking/ libs/knowledge-base/src/retrieval/compression/
git commit -m "feat(knowledge-base): add reranking providers and contextual compression

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 10: Retrieval Service (Orchestrator)

**Files:**
- Create: `libs/knowledge-base/src/retrieval/retrieval-service.ts`
- Test: `libs/knowledge-base/src/retrieval/retrieval-service.test.ts`

- [ ] **Step 1: Create `retrieval-service.ts`**

```typescript
import type { RetrievalOptions, RetrievalResult, DetailedRetrievalResult, RetrievalConfig } from '../types';
import { denseSearch } from './search/dense-search';
import { sparseSearch } from './search/sparse-search';
import { hybridSearch } from './search/hybrid-search';
import { createReranker } from './reranking/reranker-factory';
import { compressResults } from './compression/contextual-compressor';
import { createEmbeddingProvider } from '../embeddings/provider-factory';
import { createKnowledgeBaseRepository } from '../db/repositories/repository-factory';

export class RetrievalService {
  constructor(private readonly db: any) {}

  async search(query: string, options: RetrievalOptions): Promise<RetrievalResult[]> {
    const kbRepo = createKnowledgeBaseRepository(this.db);
    const kb = await kbRepo.findById(options.knowledgeBaseId);
    if (!kb) throw new Error(`Knowledge base not found: ${options.knowledgeBaseId}`);

    const config: RetrievalConfig = kb.retrievalConfig;
    const topK = options.topK ?? config.topK;
    const similarityThreshold = options.similarityThreshold ?? config.similarityThreshold;
    const searchMode = options.searchMode ?? config.searchMode;
    const hybridAlpha = options.hybridAlpha ?? config.hybridAlpha;
    const rerankProvider = options.rerankProvider ?? config.rerankProvider;
    const useCompression = options.useCompression ?? config.useCompression;

    const embeddingProvider = createEmbeddingProvider({
      provider: kb.embeddingProvider,
      model: kb.embeddingModel,
      dimensions: kb.embeddingDimensions,
    });

    let results: RetrievalResult[];
    const searchParams = {
      knowledgeBaseId: kb.id,
      query,
      topK: rerankProvider !== 'NONE' ? topK * 2 : topK,
      similarityThreshold,
      hybridAlpha,
      metadataFilters: options.metadataFilters,
      embeddingProvider,
      db: this.db,
    };

    switch (searchMode) {
      case 'DENSE':
        results = await denseSearch(searchParams);
        break;
      case 'SPARSE':
        results = await sparseSearch(searchParams);
        break;
      case 'HYBRID':
        results = await hybridSearch(searchParams);
        break;
      default:
        results = await hybridSearch(searchParams);
    }

    if (rerankProvider !== 'NONE') {
      const reranker = createReranker(rerankProvider);
      if (reranker) {
        results = await reranker.rerank(query, results, options.rerankTopK ?? topK);
      }
    }

    if (useCompression) {
      results = await compressResults(query, results);
    }

    return results.slice(0, topK);
  }

  async searchMultiKB(query: string, kbIds: string[], options: Partial<RetrievalOptions>): Promise<RetrievalResult[]> {
    const allResults = await Promise.all(
      kbIds.map(id => this.search(query, { ...options, knowledgeBaseId: id } as RetrievalOptions)),
    );
    return allResults
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK ?? 10);
  }

  async testRetrieval(query: string, kbId: string, options: Partial<RetrievalOptions> = {}): Promise<DetailedRetrievalResult[]> {
    const kbRepo = createKnowledgeBaseRepository(this.db);
    const kb = await kbRepo.findById(kbId);
    if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);

    const config: RetrievalConfig = kb.retrievalConfig;
    const topK = options.topK ?? config.topK;
    const similarityThreshold = options.similarityThreshold ?? config.similarityThreshold;
    const hybridAlpha = options.hybridAlpha ?? config.hybridAlpha;

    const embeddingProvider = createEmbeddingProvider({
      provider: kb.embeddingProvider,
      model: kb.embeddingModel,
      dimensions: kb.embeddingDimensions,
    });

    const searchParams = {
      knowledgeBaseId: kbId,
      query,
      topK: topK * 2,
      similarityThreshold,
      hybridAlpha,
      metadataFilters: options.metadataFilters,
      embeddingProvider,
      db: this.db,
    };

    const [denseResults, sparseResults, hybridResults] = await Promise.all([
      denseSearch(searchParams),
      sparseSearch(searchParams),
      hybridSearch(searchParams),
    ]);

    const denseMap = new Map(denseResults.map(r => [r.chunkId, r.denseScore]));
    const sparseMap = new Map(sparseResults.map(r => [r.chunkId, r.sparseScore]));

    return hybridResults.slice(0, topK).map(r => ({
      ...r,
      denseScore: denseMap.get(r.chunkId),
      sparseScore: sparseMap.get(r.chunkId),
      rrfScore: (r as any).rrfScore,
      compressionKept: true,
    }));
  }
}
```

- [ ] **Step 2: Write test for `retrieval-service.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./search/dense-search', () => ({
  denseSearch: vi.fn().mockResolvedValue([
    { chunkId: 'c1', content: 'Result 1', score: 0.9, denseScore: 0.9, metadata: {}, documentId: 'd1', documentName: 'doc.pdf' },
  ]),
}));
vi.mock('./search/sparse-search', () => ({
  sparseSearch: vi.fn().mockResolvedValue([
    { chunkId: 'c1', content: 'Result 1', score: 2.0, sparseScore: 2.0, metadata: {}, documentId: 'd1', documentName: 'doc.pdf' },
  ]),
}));
vi.mock('./search/hybrid-search', () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { chunkId: 'c1', content: 'Result 1', score: 0.01, rrfScore: 0.01, metadata: {}, documentId: 'd1', documentName: 'doc.pdf' },
  ]),
}));
vi.mock('../embeddings/provider-factory', () => ({
  createEmbeddingProvider: vi.fn().mockReturnValue({ embed: vi.fn(), embedBatch: vi.fn(), dimensions: 1024, maxBatchSize: 25, provider: 'BEDROCK_TITAN', model: 'test' }),
}));
vi.mock('../db/repositories/repository-factory', () => ({
  createKnowledgeBaseRepository: vi.fn().mockReturnValue({
    findById: vi.fn().mockResolvedValue({
      id: 'kb1', embeddingProvider: 'BEDROCK_TITAN', embeddingModel: 'test', embeddingDimensions: 1024,
      retrievalConfig: { topK: 10, similarityThreshold: 0.7, searchMode: 'HYBRID', hybridAlpha: 0.7, rerankProvider: 'NONE', useCompression: false },
    }),
  }),
}));

import { RetrievalService } from './retrieval-service';

describe('RetrievalService', () => {
  let service: RetrievalService;

  beforeEach(() => {
    service = new RetrievalService({} as any);
  });

  it('returns search results', async () => {
    const results = await service.search('test query', { knowledgeBaseId: 'kb1' });
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('c1');
  });

  it('searchMultiKB merges results from multiple KBs', async () => {
    const results = await service.searchMultiKB('test', ['kb1', 'kb1'], {});
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('testRetrieval returns detailed scores', async () => {
    const results = await service.testRetrieval('test', 'kb1');
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('rrfScore');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/retrieval/`

- [ ] **Step 4: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { RetrievalService } from './retrieval/retrieval-service';
export { createReranker } from './retrieval/reranking/reranker-factory';
```

- [ ] **Step 5: Commit**

```bash
git add libs/knowledge-base/src/retrieval/
git commit -m "feat(knowledge-base): add retrieval service with search, reranking, compression

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 11: Services (KB, Document, Ingestion)

**Files:**
- Create: `libs/knowledge-base/src/services/knowledge-base-service.ts`
- Create: `libs/knowledge-base/src/services/document-service.ts`
- Create: `libs/knowledge-base/src/services/ingestion-service.ts`
- Test: `libs/knowledge-base/src/services/knowledge-base-service.test.ts`

- [ ] **Step 1: Install S3 dependencies**

Run: `bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

- [ ] **Step 2: Create `knowledge-base-service.ts`**

```typescript
import { getTenantClient } from '@chatbot/shared';
import { createKnowledgeBaseRepository, createDataSourceRepository, createDocumentRepository, createDocumentChunkRepository } from '../db/repositories/repository-factory';
import type { CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput } from '../validation/schemas/knowledge-base';
import type { PaginationParams } from '@chatbot/shared';

export class KnowledgeBaseService {
  private readonly db: any;
  private readonly kbRepo: ReturnType<typeof createKnowledgeBaseRepository>;
  private readonly dsRepo: ReturnType<typeof createDataSourceRepository>;
  private readonly docRepo: ReturnType<typeof createDocumentRepository>;
  private readonly chunkRepo: ReturnType<typeof createDocumentChunkRepository>;

  constructor(tenantId: string) {
    this.db = getTenantClient(tenantId);
    this.kbRepo = createKnowledgeBaseRepository(this.db);
    this.dsRepo = createDataSourceRepository(this.db);
    this.docRepo = createDocumentRepository(this.db);
    this.chunkRepo = createDocumentChunkRepository(this.db);
  }

  list(params?: PaginationParams) {
    return this.kbRepo.findByTenantId(this.db._tenantId ?? '', params);
  }

  findById(id: string) {
    return this.kbRepo.findById(id);
  }

  create(tenantId: string, input: CreateKnowledgeBaseInput) {
    return this.kbRepo.create({ tenantId, ...input });
  }

  update(id: string, input: UpdateKnowledgeBaseInput) {
    return this.kbRepo.update(id, input);
  }

  async delete(id: string) {
    return this.kbRepo.delete(id);
  }

  listSources(kbId: string, params?: PaginationParams) {
    return this.dsRepo.findByKnowledgeBaseId(kbId, params);
  }

  listDocuments(kbId: string, params?: PaginationParams & { status?: string }) {
    return this.docRepo.findByKnowledgeBaseId(kbId, params as any);
  }

  findDocument(docId: string) {
    return this.docRepo.findById(docId);
  }

  deleteDocument(docId: string) {
    return this.docRepo.delete(docId);
  }

  listChunks(kbId: string, params?: PaginationParams & { documentId?: string }) {
    return this.chunkRepo.findByKnowledgeBaseId(kbId, params);
  }

  async getStats(kbId: string) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new Error('Knowledge base not found');
    const sources = await this.dsRepo.findByKnowledgeBaseId(kbId);
    const docs = await this.docRepo.findByKnowledgeBaseId(kbId, { limit: 1 });
    return {
      documentCount: kb.documentCount,
      chunkCount: kb.chunkCount,
      sourceCount: sources.total,
      totalDocuments: docs.total,
      status: kb.status,
    };
  }
}
```

- [ ] **Step 3: Create `document-service.ts`**

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { kbEnv } from '../env';

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: kbEnv.AWS_REGION });
  }
  return s3Client;
}

export async function generatePresignedUploadUrl(
  knowledgeBaseId: string,
  fileName: string,
  mimeType: string,
): Promise<{ uploadUrl: string; s3Key: string }> {
  const s3Key = `knowledge-base/${knowledgeBaseId}/${Date.now()}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: kbEnv.KB_S3_BUCKET,
    Key: s3Key,
    ContentType: mimeType,
  });
  const uploadUrl = await getSignedUrl(getS3(), command, { expiresIn: 3600 });
  return { uploadUrl, s3Key };
}
```

- [ ] **Step 4: Create `ingestion-service.ts`**

```typescript
import type PgBoss from 'pg-boss';
import { getTenantClient } from '@chatbot/shared';
import { createDataSourceRepository, createDocumentRepository } from '../db/repositories/repository-factory';
import type { CreateDataSourceInput } from '../validation/schemas/data-source';

export class IngestionService {
  constructor(
    private readonly boss: PgBoss,
    private readonly tenantId: string,
  ) {}

  async addFileSource(knowledgeBaseId: string, input: CreateDataSourceInput, document: {
    sourceKey: string; fileName: string; mimeType: string; sizeBytes: number;
  }) {
    const db = getTenantClient(this.tenantId);
    const dsRepo = createDataSourceRepository(db);
    const docRepo = createDocumentRepository(db);

    const source = await dsRepo.create({
      knowledgeBaseId,
      type: input.type,
      config: input.config,
    });

    const doc = await docRepo.create({
      dataSourceId: source.id,
      sourceKey: document.sourceKey,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    });

    await this.boss.send('kb.ingest', {
      knowledgeBaseId,
      dataSourceId: source.id,
      documentId: doc.id,
      s3Key: document.sourceKey,
    });

    return { source, document: doc };
  }

  async triggerSync(dataSourceId: string) {
    const db = getTenantClient(this.tenantId);
    const dsRepo = createDataSourceRepository(db);
    await dsRepo.updateStatus(dataSourceId, 'syncing');
    // Re-sync logic will be implemented in Sub-project 2
  }
}
```

- [ ] **Step 5: Write test for `knowledge-base-service.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@chatbot/shared', () => ({
  getTenantClient: vi.fn().mockReturnValue({ _tenantId: 'tenant1' }),
}));

vi.mock('../db/repositories/repository-factory', () => ({
  createKnowledgeBaseRepository: vi.fn().mockReturnValue({
    findById: vi.fn().mockResolvedValue({ id: 'kb1', name: 'Test KB', documentCount: 5, chunkCount: 100, status: 'active' }),
    findByTenantId: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'kb1', name: 'New KB' }),
    update: vi.fn().mockResolvedValue({ id: 'kb1', name: 'Updated' }),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
  createDataSourceRepository: vi.fn().mockReturnValue({
    findByKnowledgeBaseId: vi.fn().mockResolvedValue({ items: [], total: 2, limit: 20, offset: 0 }),
  }),
  createDocumentRepository: vi.fn().mockReturnValue({
    findByKnowledgeBaseId: vi.fn().mockResolvedValue({ items: [], total: 10, limit: 1, offset: 0 }),
  }),
  createDocumentChunkRepository: vi.fn().mockReturnValue({
    findByKnowledgeBaseId: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
  }),
}));

import { KnowledgeBaseService } from './knowledge-base-service';

describe('KnowledgeBaseService', () => {
  let service: KnowledgeBaseService;

  beforeEach(() => {
    service = new KnowledgeBaseService('tenant1');
  });

  it('finds a KB by id', async () => {
    const kb = await service.findById('kb1');
    expect(kb?.name).toBe('Test KB');
  });

  it('creates a KB', async () => {
    const kb = await service.create('tenant1', { name: 'New KB' } as any);
    expect(kb.name).toBe('New KB');
  });

  it('returns stats', async () => {
    const stats = await service.getStats('kb1');
    expect(stats.documentCount).toBe(5);
    expect(stats.chunkCount).toBe(100);
    expect(stats.sourceCount).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd libs/knowledge-base && bunx vitest run src/services/`

- [ ] **Step 7: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { KnowledgeBaseService } from './services/knowledge-base-service';
export { IngestionService } from './services/ingestion-service';
export { generatePresignedUploadUrl } from './services/document-service';
```

- [ ] **Step 8: Commit**

```bash
git add libs/knowledge-base/src/services/ package.json bun.lock
git commit -m "feat(knowledge-base): add KB, document, and ingestion services

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 12: Worker Jobs (pg-boss handlers)

**Files:**
- Create: `apps/workers/src/jobs/kb-ingest/handler.ts`
- Create: `apps/workers/src/jobs/kb-ingest/register.ts`
- Create: `apps/workers/src/jobs/kb-parse/handler.ts`
- Create: `apps/workers/src/jobs/kb-parse/register.ts`
- Create: `apps/workers/src/jobs/kb-chunk/handler.ts`
- Create: `apps/workers/src/jobs/kb-chunk/register.ts`
- Create: `apps/workers/src/jobs/kb-embed/handler.ts`
- Create: `apps/workers/src/jobs/kb-embed/register.ts`
- Modify: `apps/workers/src/main.ts` (register new jobs)

- [ ] **Step 1: Create `kb-ingest/handler.ts`**

```typescript
import { getPrismaClient } from '@chatbot/shared/workers';
import { createDocumentRepository } from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { z } from 'zod';

const log = createLogger('kb-ingest');

const jobSchema = z.object({
  knowledgeBaseId: z.string(),
  dataSourceId: z.string(),
  documentId: z.string(),
  s3Key: z.string(),
});

export async function handleKbIngest(data: unknown): Promise<void> {
  const { documentId } = jobSchema.parse(data);
  log.info('Starting ingestion', { documentId });

  const prisma = getPrismaClient();
  const docRepo = createDocumentRepository(prisma);
  const doc = await docRepo.findById(documentId);

  if (!doc) {
    log.warn('Document not found, skipping', { documentId });
    return;
  }

  log.info('Document ready for parsing', { documentId, fileName: doc.fileName });
}
```

- [ ] **Step 2: Create `kb-ingest/register.ts`**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleKbIngest } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('kb-ingest-register');
const JOB_NAME = 'kb.ingest';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleKbIngest);
  }

  await boss.work(JOB_NAME, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
      await boss.send('kb.parse', { documentId: (job.data as any).documentId });
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 3: Create `kb-parse/handler.ts`**

```typescript
import { getPrismaClient } from '@chatbot/shared/workers';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createDocumentRepository, createKnowledgeBaseRepository } from '@chatbot/knowledge-base';
import { createParser } from '@chatbot/knowledge-base';
import { runPreProcessing } from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { z } from 'zod';

const log = createLogger('kb-parse');

const jobSchema = z.object({ documentId: z.string() });

export async function handleKbParse(data: unknown): Promise<void> {
  const { documentId } = jobSchema.parse(data);
  log.info('Parsing document', { documentId });

  const prisma = getPrismaClient();
  const docRepo = createDocumentRepository(prisma);
  const doc = await docRepo.findById(documentId);
  if (!doc) { log.warn('Document not found'); return; }

  try {
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.KB_S3_BUCKET!,
      Key: doc.sourceKey,
    }));
    const buffer = Buffer.from(await obj.Body!.transformToByteArray());

    const parser = createParser(doc.mimeType);
    let text: string;
    try {
      text = await parser.parse(buffer, doc.mimeType);
    } catch (err: any) {
      if (err.message === 'PDF_NEEDS_OCR') {
        text = '';
      } else {
        throw err;
      }
    }

    const kbRepo = createKnowledgeBaseRepository(prisma);
    const ds = await prisma.dataSource.findUnique({ where: { id: doc.dataSourceId } });
    const kb = ds ? await kbRepo.findById(ds.knowledgeBaseId) : null;
    const preProcessingConfig = kb?.preProcessing ?? { htmlStripping: true, piiRedaction: false, ocrEnabled: false, tableExtraction: true };

    const { text: processedText, tables } = await runPreProcessing(text, buffer, preProcessingConfig as any);
    const finalText = tables.length > 0 ? processedText + '\n\n' + tables.join('\n\n') : processedText;

    await docRepo.updateProcessedText(documentId, finalText);
    log.info('Document parsed successfully', { documentId, textLength: finalText.length });
  } catch (err: any) {
    log.error('Parse failed', { documentId, error: err.message });
    await docRepo.updateStatus(documentId, 'FAILED', err.message);
  }
}
```

- [ ] **Step 4: Create `kb-parse/register.ts`**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleKbParse } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('kb-parse-register');
const JOB_NAME = 'kb.parse';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleKbParse);
  }

  await boss.work(JOB_NAME, { batchSize: 3 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
      await boss.send('kb.chunk', { documentId: (job.data as any).documentId });
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 5: Create `kb-chunk/handler.ts`**

```typescript
import { getPrismaClient } from '@chatbot/shared/workers';
import { createDocumentRepository, createDocumentChunkRepository, createKnowledgeBaseRepository } from '@chatbot/knowledge-base';
import { createChunker } from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { z } from 'zod';

const log = createLogger('kb-chunk');

const jobSchema = z.object({ documentId: z.string() });

export async function handleKbChunk(data: unknown): Promise<void> {
  const { documentId } = jobSchema.parse(data);
  log.info('Chunking document', { documentId });

  const prisma = getPrismaClient();
  const docRepo = createDocumentRepository(prisma);
  const chunkRepo = createDocumentChunkRepository(prisma);
  const doc = await docRepo.findById(documentId);
  if (!doc || !doc.processedText) { log.warn('Document not ready for chunking'); return; }

  try {
    const ds = await prisma.dataSource.findUnique({ where: { id: doc.dataSourceId } });
    const kbRepo = createKnowledgeBaseRepository(prisma);
    const kb = ds ? await kbRepo.findById(ds.knowledgeBaseId) : null;
    if (!kb) { throw new Error('Knowledge base not found'); }

    const chunker = createChunker(kb.chunkStrategy as any);
    const chunks = chunker.chunk(doc.processedText, kb.chunkSize, kb.chunkOverlap);

    const chunkInputs = chunks.map((c, i) => ({
      documentId,
      chunkIndex: i,
      content: c.content,
      tokenCount: c.tokenCount,
      metadata: c.metadata,
    }));

    const count = await chunkRepo.createMany(chunkInputs);
    await kbRepo.incrementChunkCount(kb.id, count);

    // Store tsvectors for BM25 search
    const createdChunks = await prisma.documentChunk.findMany({
      where: { documentId },
      select: { id: true, content: true },
      orderBy: { chunkIndex: 'asc' },
    });
    await chunkRepo.storeTsvectorBatch(createdChunks.map((c: any) => ({ chunkId: c.id, content: c.content })));

    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    await docRepo.updateTokenCount(documentId, totalTokens);
    await docRepo.updateStatus(documentId, 'CHUNKING');

    log.info('Chunking complete', { documentId, chunkCount: count });
  } catch (err: any) {
    log.error('Chunking failed', { documentId, error: err.message });
    await docRepo.updateStatus(documentId, 'FAILED', err.message);
  }
}
```

- [ ] **Step 6: Create `kb-chunk/register.ts`**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleKbChunk } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('kb-chunk-register');
const JOB_NAME = 'kb.chunk';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleKbChunk);
  }

  await boss.work(JOB_NAME, { batchSize: 3 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
      await boss.send('kb.embed', { documentId: (job.data as any).documentId });
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 7: Create `kb-embed/handler.ts`**

```typescript
import { getPrismaClient } from '@chatbot/shared/workers';
import { createDocumentRepository, createDocumentChunkRepository, createKnowledgeBaseRepository, createEmbeddingProvider } from '@chatbot/knowledge-base';
import { createLogger } from '../../lib/logger.js';
import { z } from 'zod';

const log = createLogger('kb-embed');

const jobSchema = z.object({ documentId: z.string() });

export async function handleKbEmbed(data: unknown): Promise<void> {
  const { documentId } = jobSchema.parse(data);
  log.info('Embedding document chunks', { documentId });

  const prisma = getPrismaClient();
  const docRepo = createDocumentRepository(prisma);
  const chunkRepo = createDocumentChunkRepository(prisma);
  const kbRepo = createKnowledgeBaseRepository(prisma);

  const doc = await docRepo.findById(documentId);
  if (!doc) { log.warn('Document not found'); return; }

  try {
    const ds = await prisma.dataSource.findUnique({ where: { id: doc.dataSourceId } });
    const kb = ds ? await kbRepo.findById(ds.knowledgeBaseId) : null;
    if (!kb) throw new Error('Knowledge base not found');

    const provider = createEmbeddingProvider({
      provider: kb.embeddingProvider as any,
      model: kb.embeddingModel,
      dimensions: kb.embeddingDimensions,
    });

    const chunkIds = await chunkRepo.getChunkIdsWithoutEmbedding(documentId);
    if (chunkIds.length === 0) {
      await docRepo.updateStatus(documentId, 'READY');
      await kbRepo.incrementDocumentCount(kb.id);
      return;
    }

    const chunks = await prisma.documentChunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, content: true },
      orderBy: { chunkIndex: 'asc' },
    });

    for (let i = 0; i < chunks.length; i += provider.maxBatchSize) {
      const batch = chunks.slice(i, i + provider.maxBatchSize);
      const texts = batch.map((c: any) => c.content);
      const embeddings = await provider.embedBatch(texts);

      const pairs = batch.map((c: any, idx: number) => ({
        chunkId: c.id,
        embedding: embeddings[idx],
      }));
      await chunkRepo.storeEmbeddingsBatch(pairs);

      log.info('Batch embedded', { documentId, batch: Math.floor(i / provider.maxBatchSize) + 1, total: Math.ceil(chunks.length / provider.maxBatchSize) });
    }

    await docRepo.updateStatus(documentId, 'READY');
    await kbRepo.incrementDocumentCount(kb.id);
    log.info('Embedding complete', { documentId, chunkCount: chunks.length });
  } catch (err: any) {
    log.error('Embedding failed', { documentId, error: err.message });
    await docRepo.updateStatus(documentId, 'FAILED', err.message);
  }
}
```

- [ ] **Step 8: Create `kb-embed/register.ts`**

```typescript
import type PgBoss from 'pg-boss';
import type { JobExecutor } from '../../executor/types.js';
import { handleKbEmbed } from './handler.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('kb-embed-register');
const JOB_NAME = 'kb.embed';

export async function register(boss: PgBoss, executor: JobExecutor): Promise<void> {
  if (executor.registerHandler) {
    executor.registerHandler(JOB_NAME, handleKbEmbed);
  }

  await boss.work(JOB_NAME, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      log.info('Processing job', { jobId: job.id });
      await executor.execute(JOB_NAME, job.data);
    }
  });

  log.info('Registered job handler', { jobName: JOB_NAME });
}
```

- [ ] **Step 9: Register all KB jobs in `apps/workers/src/main.ts`**

Add imports and registration calls for all four KB jobs alongside existing message-embedding and conversation-summary registrations.

- [ ] **Step 10: Verify workers build**

Run: `nx build workers`

- [ ] **Step 11: Commit**

```bash
git add apps/workers/src/jobs/kb-ingest/ apps/workers/src/jobs/kb-parse/ apps/workers/src/jobs/kb-chunk/ apps/workers/src/jobs/kb-embed/ apps/workers/src/main.ts
git commit -m "feat(knowledge-base): add pg-boss worker jobs for ingestion pipeline

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 13: UMAP Projector

**Files:**
- Create: `libs/knowledge-base/src/testing/umap-projector.ts`
- Test: `libs/knowledge-base/src/testing/umap-projector.test.ts`

- [ ] **Step 1: Install umap-js**

Run: `bun add umap-js`

- [ ] **Step 2: Create `umap-projector.ts`**

```typescript
import { UMAP } from 'umap-js';

interface UmapPoint {
  chunkId: string;
  documentId: string;
  documentName: string;
  x: number;
  y: number;
  content: string;
}

const projectionCache = new Map<string, { points: UmapPoint[]; chunkCount: number }>();

export async function projectEmbeddings(
  kbId: string,
  db: any,
  maxSamples = 5000,
): Promise<UmapPoint[]> {
  const countResult: Array<{ count: bigint }> = await db.$queryRawUnsafe(`
    SELECT COUNT(*) as count FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    JOIN data_sources ds ON ds.id = d.data_source_id
    WHERE ds.knowledge_base_id = $1 AND dc.embedding IS NOT NULL
  `, kbId);
  const totalChunks = Number(countResult[0]?.count ?? 0);

  const cached = projectionCache.get(kbId);
  if (cached && cached.chunkCount === totalChunks) {
    return cached.points;
  }

  const limitClause = totalChunks > maxSamples
    ? `ORDER BY RANDOM() LIMIT ${maxSamples}`
    : 'ORDER BY dc.chunk_index';

  const rows: Array<{
    id: string; document_id: string; file_name: string;
    content: string; embedding: number[];
  }> = await db.$queryRawUnsafe(`
    SELECT dc.id, dc.document_id, d.file_name, LEFT(dc.content, 200) as content,
           dc.embedding::text as embedding
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    JOIN data_sources ds ON ds.id = d.data_source_id
    WHERE ds.knowledge_base_id = $1 AND dc.embedding IS NOT NULL
    ${limitClause}
  `, kbId);

  if (rows.length < 2) return [];

  const embeddings = rows.map(r => {
    const str = typeof r.embedding === 'string' ? r.embedding : String(r.embedding);
    return str.replace(/[\[\]]/g, '').split(',').map(Number);
  });

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(15, rows.length - 1),
    minDist: 0.1,
  });

  const projected = umap.fit(embeddings);

  const points: UmapPoint[] = rows.map((r, i) => ({
    chunkId: r.id,
    documentId: r.document_id,
    documentName: r.file_name,
    x: projected[i][0],
    y: projected[i][1],
    content: r.content,
  }));

  projectionCache.set(kbId, { points, chunkCount: totalChunks });
  return points;
}

export function invalidateProjectionCache(kbId: string): void {
  projectionCache.delete(kbId);
}
```

- [ ] **Step 3: Write test for `umap-projector.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('umap-js', () => ({
  UMAP: vi.fn().mockImplementation(() => ({
    fit: vi.fn().mockReturnValue([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]),
  })),
}));

import { projectEmbeddings, invalidateProjectionCache } from './umap-projector';

describe('projectEmbeddings', () => {
  const mockDb = {
    $queryRawUnsafe: vi.fn()
      .mockResolvedValueOnce([{ count: BigInt(3) }])
      .mockResolvedValueOnce([
        { id: 'c1', document_id: 'd1', file_name: 'doc1.pdf', content: 'chunk 1', embedding: '[0.1,0.2,0.3]' },
        { id: 'c2', document_id: 'd1', file_name: 'doc1.pdf', content: 'chunk 2', embedding: '[0.4,0.5,0.6]' },
        { id: 'c3', document_id: 'd2', file_name: 'doc2.pdf', content: 'chunk 3', embedding: '[0.7,0.8,0.9]' },
      ]),
  };

  it('returns projected 2D points', async () => {
    invalidateProjectionCache('kb1');
    const points = await projectEmbeddings('kb1', mockDb);
    expect(points).toHaveLength(3);
    expect(points[0]).toHaveProperty('x');
    expect(points[0]).toHaveProperty('y');
    expect(points[0]).toHaveProperty('chunkId');
    expect(points[0]).toHaveProperty('documentName');
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd libs/knowledge-base && bunx vitest run src/testing/`

- [ ] **Step 5: Update barrel export**

Add to `libs/knowledge-base/src/index.ts`:
```typescript
export { projectEmbeddings, invalidateProjectionCache } from './testing/umap-projector';
```

- [ ] **Step 6: Commit**

```bash
git add libs/knowledge-base/src/testing/ package.json bun.lock
git commit -m "feat(knowledge-base): add UMAP embedding projector with caching

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 14: API Routes — KB CRUD + Sources + Documents

**Files:**
- Create: `apps/web-ui/app/api/knowledge-base/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/sources/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/sources/[sid]/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/sources/[sid]/sync/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/documents/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/documents/[did]/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/upload/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/stats/route.ts`
- Modify: `apps/web-ui/next.config.ts` (add transpilePackages)

- [ ] **Step 1: Add `@chatbot/knowledge-base` to `next.config.ts` transpilePackages**

Add `'@chatbot/knowledge-base'` to the `transpilePackages` array alongside existing `@chatbot/shared` and `@chatbot/ai`.

- [ ] **Step 2: Create `api/knowledge-base/route.ts`** (POST create, GET list)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService, createKnowledgeBaseSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const service = new KnowledgeBaseService(tenantId);
    const result = await service.list({ limit, offset });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const input = createKnowledgeBaseSchema.parse(body);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.create(tenantId, input);
    return NextResponse.json(kb, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `api/knowledge-base/[id]/route.ts`** (GET detail, PATCH update, DELETE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService, updateKnowledgeBaseSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.findById(id);
    if (!kb) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(kb);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const input = updateKnowledgeBaseSchema.parse(body);

    const service = new KnowledgeBaseService(tenantId);
    const kb = await service.update(id, input);
    return NextResponse.json(kb);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new KnowledgeBaseService(tenantId);
    await service.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create `[id]/sources/route.ts`** (POST add source, GET list)

Follow the same pattern as KB CRUD. POST creates a DataSource via `IngestionService.addFileSource()` and triggers the ingestion pipeline. GET lists sources via `KnowledgeBaseService.listSources()`.

- [ ] **Step 5: Create `[id]/sources/[sid]/route.ts`** (DELETE)

Delete a data source and its documents.

- [ ] **Step 6: Create `[id]/sources/[sid]/sync/route.ts`** (POST)

Trigger re-sync via `IngestionService.triggerSync()`.

- [ ] **Step 7: Create `[id]/documents/route.ts`** (GET list)

List documents with pagination and optional status filter via `KnowledgeBaseService.listDocuments()`.

- [ ] **Step 8: Create `[id]/documents/[did]/route.ts`** (GET detail, DELETE)

Get document detail or delete document via `KnowledgeBaseService`.

- [ ] **Step 9: Create `[id]/upload/route.ts`** (POST presigned URL)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { generatePresignedUploadUrl, uploadDocumentSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const { fileName, mimeType } = uploadDocumentSchema.parse(body);

    const result = await generatePresignedUploadUrl(id, fileName, mimeType);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 10: Create `[id]/stats/route.ts`** (GET)

Return KB stats via `KnowledgeBaseService.getStats()`.

- [ ] **Step 11: Verify build**

Run: `nx build web-ui`

- [ ] **Step 12: Commit**

```bash
git add apps/web-ui/app/api/knowledge-base/ apps/web-ui/next.config.ts
git commit -m "feat(knowledge-base): add API routes for KB CRUD, sources, documents, upload

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

### Task 15: API Routes — Search, Test, Chunks

**Files:**
- Create: `apps/web-ui/app/api/knowledge-base/[id]/search/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/search/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/test/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/chunks/route.ts`
- Create: `apps/web-ui/app/api/knowledge-base/[id]/chunks/embeddings/route.ts`

- [ ] **Step 1: Create `[id]/search/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getTenantClient } from '@chatbot/shared';
import { RetrievalService, searchSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const input = searchSchema.parse(body);

    const db = getTenantClient(tenantId);
    const service = new RetrievalService(db);
    const results = await service.search(input.query, {
      knowledgeBaseId: id,
      ...input,
    });

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `search/route.ts`** (multi-KB search)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getTenantClient } from '@chatbot/shared';
import { RetrievalService, multiKBSearchSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const input = multiKBSearchSchema.parse(body);

    const db = getTenantClient(tenantId);
    const service = new RetrievalService(db);
    const results = await service.searchMultiKB(input.query, input.knowledgeBaseIds, input);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `[id]/test/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getTenantClient } from '@chatbot/shared';
import { RetrievalService, searchSchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const input = searchSchema.parse(body);

    const db = getTenantClient(tenantId);
    const service = new RetrievalService(db);
    const results = await service.testRetrieval(input.query, id, input);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create `[id]/chunks/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { KnowledgeBaseService, chunkQuerySchema } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const query = chunkQuerySchema.parse(Object.fromEntries(searchParams));

    const service = new KnowledgeBaseService(tenantId);
    const result = await service.listChunks(id, query);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Create `[id]/chunks/embeddings/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getTenantClient } from '@chatbot/shared';
import { projectEmbeddings } from '@chatbot/knowledge-base';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'KnowledgeBases', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getTenantClient(tenantId);
    const points = await projectEmbeddings(id, db);
    return NextResponse.json({ points });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Verify build**

Run: `nx build web-ui`

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/app/api/knowledge-base/
git commit -m "feat(knowledge-base): add search, test, chunks, and UMAP API routes

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```


---

### Task 16: Testing UI Pages

**Files:**
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/create/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/[id]/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/[id]/settings/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/[id]/documents/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/[id]/test/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/knowledge-base/[id]/visualize/page.tsx`
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx` (add KB nav item)

This task is large — it covers 7 pages. Each page should be implemented as a client component using existing shadcn/ui components from the project. Use the `frontend-design` skill when implementing each page for design quality.

- [ ] **Step 1: Add KB nav item to sidebar**

Add a "Knowledge Base" link to the sidebar navigation in `apps/web-ui/components/layout/app-sidebar.tsx`, using the `Database` icon from lucide-react. Place it after the existing "Conversations" link. Route: `/knowledge-base`.

- [ ] **Step 2: Create KB list page (`page.tsx`)**

Grid of cards showing each KB with:
- Name, description, status badge
- Document count, chunk count
- Embedding provider + model
- Chunk strategy
- "Create New" button linking to `/knowledge-base/create`
- Each card links to `/knowledge-base/[id]`

Fetch data from `GET /api/knowledge-base` with pagination.

- [ ] **Step 3: Create KB creation wizard (`create/page.tsx`)**

Multi-step form:
1. **Basic info**: name, description
2. **Embedding config**: provider dropdown (Bedrock Titan, OpenAI, Cohere, Local), model text input, dimensions number input
3. **Chunking config**: strategy dropdown, chunk size slider (100-4000), overlap slider (0-500)
4. **Pre-processing**: toggle switches for HTML stripping, PII redaction, OCR, table extraction
5. **Retrieval defaults**: search mode dropdown, top-k slider, similarity threshold slider, hybrid alpha slider, rerank provider dropdown, compression toggle

Submit to `POST /api/knowledge-base`. Redirect to `/knowledge-base/[id]` on success.

- [ ] **Step 4: Create KB detail page (`[id]/page.tsx`)**

Overview dashboard showing:
- KB name, description, status
- Stats cards: document count, chunk count, source count
- Recent documents list with status badges (PENDING, PROCESSING, READY, FAILED)
- Quick action buttons: Upload Document, Test Retrieval, View Chunks
- Navigation tabs/links to settings, documents, test, visualize sub-pages

Fetch from `GET /api/knowledge-base/[id]` and `GET /api/knowledge-base/[id]/stats`.

- [ ] **Step 5: Create settings page (`[id]/settings/page.tsx`)**

Edit form matching the create wizard fields. Pre-populated with current KB config. Submit to `PATCH /api/knowledge-base/[id]`. Include a danger zone with archive/delete actions.

- [ ] **Step 6: Create documents page (`[id]/documents/page.tsx`)**

- File upload zone (drag-and-drop or click) that:
  1. Calls `POST /api/knowledge-base/[id]/upload` to get presigned URL
  2. Uploads file directly to S3 via presigned URL
  3. Calls `POST /api/knowledge-base/[id]/sources` to create source + trigger ingestion
- Document table with columns: file name, size, status (with color-coded badge), token count, created date
- Status auto-refreshes every 5 seconds for documents in PENDING/PROCESSING/CHUNKING/EMBEDDING states
- Delete button per document

Fetch from `GET /api/knowledge-base/[id]/documents` with pagination.

- [ ] **Step 7: Create retrieval test page (`[id]/test/page.tsx`)**

Two-tab layout:

**Tab 1: Retrieval Tester**
- Query text input
- Controls panel: search mode dropdown, top-k slider, similarity threshold slider, hybrid alpha slider, rerank provider dropdown, compression toggle
- "Search" button
- Results list showing:
  - Chunk content (expandable)
  - Final score (large, prominent)
  - Per-stage scores: dense, sparse, RRF, rerank (smaller, in a details row)
  - Source document name + metadata (page, heading path)

Calls `POST /api/knowledge-base/[id]/test` for detailed results.

**Tab 2: Chunk Browser**
- Paginated list of all chunks
- Filter by document dropdown
- Each chunk card shows: chunk index, content (truncated, expandable), token count, metadata JSON
- Fetch from `GET /api/knowledge-base/[id]/chunks`

- [ ] **Step 8: Create UMAP visualization page (`[id]/visualize/page.tsx`)**

- Canvas-based 2D scatter plot
- Fetch data from `GET /api/knowledge-base/[id]/chunks/embeddings`
- Each point colored by source document (use a color palette with legend)
- Hover tooltip showing: chunk content preview, document name, chunk ID
- Click to expand full chunk content in a side panel
- Zoom and pan controls
- Use a lightweight canvas library or raw Canvas API — avoid heavy charting libraries

For the scatter plot, use an HTML5 Canvas element with:
- `wheel` event for zoom
- `mousedown`/`mousemove`/`mouseup` for pan
- `mousemove` for hover detection (check distance to each point)
- Color palette: 10 distinct colors, assigned by document ID

- [ ] **Step 9: Verify all pages render**

Run: `bun run dev` and navigate to:
- `/knowledge-base` — list page loads
- `/knowledge-base/create` — wizard renders
- Test with a real KB if database is available

- [ ] **Step 10: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/knowledge-base/ apps/web-ui/components/layout/app-sidebar.tsx
git commit -m "feat(knowledge-base): add testing UI pages (list, create, detail, test, UMAP)

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

### Task 17: Integration Wiring + Final Verification

**Files:**
- Modify: `libs/knowledge-base/src/index.ts` (final barrel export audit)
- Modify: `apps/web-ui/next.config.ts` (verify serverExternalPackages)
- Modify: `.env.example` (add KB env vars)

- [ ] **Step 1: Audit barrel export**

Ensure `libs/knowledge-base/src/index.ts` exports everything needed by `apps/web-ui` and `apps/workers`:
- All types and enums
- All validation schemas and their inferred types
- All repository factory functions and interfaces
- All service classes
- Embedding provider factory
- Retrieval service
- UMAP projector
- Parser factory and chunker factory (needed by workers)
- Pre-processing pipeline (needed by workers)

- [ ] **Step 2: Add serverExternalPackages**

In `apps/web-ui/next.config.ts`, add to `serverExternalPackages`:
- `pdf-parse`
- `mammoth`
- `xlsx`
- `@aws-sdk/client-textract`
- `@aws-sdk/client-s3`
- `cohere-ai`
- `umap-js`

These must not be bundled by Next.js — they're server-only dependencies.

- [ ] **Step 3: Update `.env.example`**

Add:
```
# Knowledge Base
KB_S3_BUCKET=chatbot-knowledge-base
# OPENAI_API_KEY=sk-...
# COHERE_API_KEY=...
# OLLAMA_BASE_URL=http://localhost:11434
```

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: All existing tests pass + all new KB tests pass

- [ ] **Step 5: Run build**

Run: `bun run build`
Expected: All projects build successfully

- [ ] **Step 6: Commit**

```bash
git add libs/knowledge-base/src/index.ts apps/web-ui/next.config.ts .env.example
git commit -m "feat(knowledge-base): final wiring, env vars, and build verification

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Nx library scaffold + Prisma schema | `libs/knowledge-base/`, `prisma/schema.prisma` |
| 2 | Zod validation schemas | `src/validation/` |
| 3 | Repository layer | `src/db/repositories/` |
| 4 | Document parsers | `src/ingestion/parsers/` |
| 5 | Pre-processing pipeline | `src/ingestion/pre-processing/` |
| 6 | Chunking strategies | `src/ingestion/chunking/` |
| 7 | Embedding providers | `src/embeddings/` |
| 8 | Search (dense, sparse, hybrid) | `src/retrieval/search/` |
| 9 | Reranking + compression | `src/retrieval/reranking/`, `src/retrieval/compression/` |
| 10 | Retrieval service orchestrator | `src/retrieval/retrieval-service.ts` |
| 11 | KB, document, ingestion services | `src/services/` |
| 12 | pg-boss worker jobs | `apps/workers/src/jobs/kb-*` |
| 13 | UMAP projector | `src/testing/umap-projector.ts` |
| 14 | API routes — CRUD, sources, documents | `apps/web-ui/app/api/knowledge-base/` |
| 15 | API routes — search, test, chunks | `apps/web-ui/app/api/knowledge-base/` |
| 16 | Testing UI pages | `apps/web-ui/app/(dashboard)/knowledge-base/` |
| 17 | Integration wiring + verification | Final exports, config, env |

**Total: 17 tasks, ~70 files, ~17 commits**

