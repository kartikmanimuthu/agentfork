# Knowledge Base — Core Foundation Design Spec

**Sub-project:** 1 of 5 (Core KB Foundation)  
**Status:** Approved  
**Date:** 2026-05-05  
**Author:** Kartik Manimuthu + Claude  
**PRD Reference:** AgentStudio PRD Section 3 — Knowledge Base Management

---

## Scope

This spec covers the core knowledge base module for the chatbot platform. It is the first of five sub-projects that together implement the full PRD Section 3.

**In scope (this sub-project):**
- Prisma schema for KB entities
- File upload ingestion (PDF, DOCX, TXT, MD, CSV, JSON, XLSX, HTML)
- Pre-processing pipeline (HTML stripping, PII redaction, OCR, table extraction)
- All 5 chunking strategies (fixed-size, recursive character, semantic, markdown-aware, code-aware)
- Multi-provider embeddings (Bedrock Titan, OpenAI, Cohere, local/Ollama)
- pgvector storage with HNSW indexes
- Full retrieval stack (dense, sparse, hybrid RRF, reranking, contextual compression)
- REST API routes (18 endpoints)
- Testing UI (retrieval tester, chunk browser, UMAP visualization)
- New Nx library: `libs/knowledge-base`

**Deferred to later sub-projects:**
- URL scraping and crawling (Sub-project 2)
- Connector integrations — Notion, Confluence, Google Drive, etc. (Sub-project 2)
- BYOC vector stores — Pinecone, Weaviate, Qdrant, etc. (Sub-project 3)
- Scheduled re-sync and incremental sync (Sub-project 2)

---

## Architecture

### Module Structure

New Nx library `libs/knowledge-base` alongside existing `libs/ai` and `libs/shared`.

```
libs/knowledge-base/
  src/
    index.ts                          # Public API barrel export
    
    # Data access
    db/
      repositories/
        knowledge-base/
          interface.ts
          postgres.ts
        data-source/
          interface.ts
          postgres.ts
        document/
          interface.ts
          postgres.ts
        document-chunk/
          interface.ts
          postgres.ts
      repository-factory.ts
    
    # Ingestion pipeline
    ingestion/
      parsers/
        pdf-parser.ts                 # pdf-parse + Textract fallback
        docx-parser.ts                # mammoth
        text-parser.ts                # TXT, MD, CSV, JSON
        html-parser.ts                # HTML → text
        xlsx-parser.ts                # XLSX → text/markdown
        parser-factory.ts             # Select parser by MIME type
      pre-processing/
        html-stripper.ts
        pii-redactor.ts
        ocr-processor.ts              # AWS Textract
        table-extractor.ts
        pipeline.ts                   # Orchestrates pre-processing steps
      chunking/
        fixed-size.ts
        recursive-character.ts
        semantic.ts                   # Sentence-level splitting
        markdown-aware.ts             # Preserves heading structure
        code-aware.ts                 # Language-aware code splitting
        chunker-factory.ts            # Select strategy by config
    
    # Embedding providers
    embeddings/
      provider.ts                     # EmbeddingProvider interface
      bedrock-titan.ts
      openai.ts
      cohere.ts
      local-ollama.ts
      provider-factory.ts
    
    # Retrieval
    retrieval/
      search/
        dense-search.ts               # pgvector cosine similarity
        sparse-search.ts              # tsvector BM25
        hybrid-search.ts              # RRF merge
      reranking/
        cohere-reranker.ts
        cross-encoder-reranker.ts
        reranker-factory.ts
      compression/
        contextual-compressor.ts      # LLM-based relevance filter
      retrieval-service.ts            # Main retrieval orchestrator
    
    # Testing / analysis
    testing/
      umap-projector.ts              # umap-js 2D projection + caching
    
    # Validation schemas
    validation/
      schemas/
        knowledge-base.ts
        data-source.ts
        document.ts
        retrieval.ts
    
    # Types
    types.ts
  
  project.json
  tsconfig.json
  tsconfig.lib.json
  vitest.config.ts
```

**Path alias:** `@chatbot/knowledge-base` → `libs/knowledge-base/src/index.ts`

### Dependencies

- `libs/knowledge-base` → `libs/shared` (Prisma client, tenant middleware, auth)
- `libs/knowledge-base` → `libs/ai` (reuses Bedrock client setup)
- `apps/web-ui` → `libs/knowledge-base` (API routes)
- `apps/workers` → `libs/knowledge-base` (job handlers)

---

## Data Model

### New Prisma Models

```prisma
model KnowledgeBase {
  id                  String   @id @default(cuid())
  tenantId            String
  name                String
  description         String?
  
  // Embedding configuration
  embeddingProvider   String   @default("BEDROCK_TITAN")  // BEDROCK_TITAN | OPENAI | COHERE | LOCAL
  embeddingModel      String   @default("amazon.titan-embed-text-v2:0")
  embeddingDimensions Int      @default(1024)
  
  // Chunking configuration
  chunkStrategy       String   @default("RECURSIVE_CHARACTER")
  chunkSize           Int      @default(512)
  chunkOverlap        Int      @default(50)
  
  // Pre-processing configuration
  preProcessing       Json     @default("{\"htmlStripping\":true,\"piiRedaction\":false,\"ocrEnabled\":false,\"tableExtraction\":true}")
  
  // Retrieval defaults
  retrievalConfig     Json     @default("{\"topK\":10,\"similarityThreshold\":0.7,\"searchMode\":\"HYBRID\",\"hybridAlpha\":0.7,\"rerankProvider\":\"NONE\",\"useCompression\":false}")
  
  status              String   @default("active")  // active | archived
  documentCount       Int      @default(0)
  chunkCount          Int      @default(0)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenant    Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sources   DataSource[]

  @@index([tenantId])
  @@index([tenantId, status])
  @@map("knowledge_bases")
}

model DataSource {
  id               String    @id @default(cuid())
  knowledgeBaseId  String
  type             String    // FILE | URL | CONNECTOR
  config           Json      // Type-specific config (file metadata, URL, connector settings)
  status           String    @default("active")  // active | syncing | error | disabled
  lastSyncAt       DateTime?
  syncSchedule     String?   // Cron expression for scheduled re-sync
  errorMessage     String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  documents     Document[]

  @@index([knowledgeBaseId])
  @@map("data_sources")
}

model Document {
  id            String   @id @default(cuid())
  dataSourceId  String
  sourceKey     String   // S3 key for raw file
  fileName      String
  mimeType      String
  sizeBytes     Int
  metadata      Json?    // Arbitrary metadata (page count, author, etc.)
  processedText String?  @db.Text  // Extracted + pre-processed text (before chunking)
  status        String   @default("PENDING")  // PENDING | PROCESSING | CHUNKING | EMBEDDING | READY | FAILED
  errorMessage  String?
  tokenCount    Int?     // Total tokens across all chunks
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  dataSource DataSource      @relation(fields: [dataSourceId], references: [id], onDelete: Cascade)
  chunks     DocumentChunk[]

  @@index([dataSourceId])
  @@index([dataSourceId, status])
  @@map("documents")
}

model DocumentChunk {
  id          String                       @id @default(cuid())
  documentId  String
  chunkIndex  Int
  content     String
  tokenCount  Int
  metadata    Json?                        // Page number, heading path, source URL, etc.
  // NOTE: embedding column is NOT defined in Prisma (Unsupported type with variable dimensions).
  // Created via raw SQL migration per KB's embeddingDimensions. All chunks in a KB share
  // the same dimension, so the HNSW index works. We use raw SQL for vector operations.
  // Column: embedding vector(N) where N = KB's embeddingDimensions
  searchText  Unsupported("tsvector")?     // For BM25 sparse search (language: 'english' default)
  createdAt   DateTime                     @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([documentId, chunkIndex])
  @@map("document_chunks")
}
```

### Vector Indexes (raw SQL migration)

```sql
-- Embedding column added dynamically when KB is created.
-- Dimension matches KB's embeddingDimensions config.
-- Example for 1024-dim (Bedrock Titan / Cohere):
ALTER TABLE document_chunks ADD COLUMN embedding vector(1024);

-- HNSW index for dense search (cosine similarity)
-- Created per-dimension. If multiple KBs use different dimensions,
-- chunks are scoped by documentId → dataSourceId → knowledgeBaseId,
-- so queries always filter to a single KB's dimension space.
CREATE INDEX idx_document_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for sparse search (tsvector)
CREATE INDEX idx_document_chunks_search_text ON document_chunks
  USING gin (search_text);

-- GIN index for metadata filtering
CREATE INDEX idx_document_chunks_metadata ON document_chunks
  USING gin (metadata jsonb_path_ops);
```

**Vector dimension strategy:** All KBs in the system share the `document_chunks` table. Since pgvector requires a fixed dimension per column, we use the maximum dimension across all active KBs (3072 for OpenAI large). Providers with smaller dimensions (1024, 1536) pad with zeros. The HNSW index works across all dimensions this way. An alternative is separate tables per dimension — simpler queries but more schema management. We go with the single-table approach for simplicity, with zero-padding handled transparently in the embedding provider layer.

### Schema Changes to Existing Models

Add relation to `Tenant`:

```prisma
model Tenant {
  // ...existing fields
  knowledgeBases KnowledgeBase[]
}
```

---

## Processing Pipeline

### Job Chain (pg-boss)

```
kb.ingest  →  kb.parse  →  kb.chunk  →  kb.embed
```

Each job is a separate pg-boss job type. Jobs are chained: completion of one enqueues the next.

#### kb.ingest

**Input:** `{ knowledgeBaseId, dataSourceId, documentId, s3Key }`  
**Action:** Creates Document record with status `PENDING`, enqueues `kb.parse`  
**Output:** Document ID

#### kb.parse

**Input:** `{ documentId }`  
**Action:**
1. Download raw file from S3
2. Select parser by MIME type (pdf-parse, mammoth, text, html, xlsx)
3. Extract text content
4. Run pre-processing pipeline:
   - HTML stripping (if enabled)
   - PII redaction (if enabled, using configurable regex patterns)
   - OCR via AWS Textract (if enabled, for scanned PDFs)
   - Table extraction to markdown (if enabled)
5. Store processed text on Document, update status to `PROCESSING`
6. Enqueue `kb.chunk`

**Error handling:** On failure, Document status → `FAILED`, error stored in `errorMessage`

#### kb.chunk

**Input:** `{ documentId }`  
**Action:**
1. Read processed text from Document
2. Select chunking strategy from KB config
3. Split text into chunks
4. Create DocumentChunk records with content, chunkIndex, tokenCount, metadata
5. Generate tsvector for each chunk (for BM25 sparse search)
6. Update Document status to `CHUNKING`, then enqueue `kb.embed`
7. Update KB `chunkCount`

#### kb.embed

**Input:** `{ documentId }`  
**Action:**
1. Load all chunks for document that lack embeddings
2. Create embedding provider from KB config via factory
3. Generate embeddings in batches (respecting provider's `maxBatchSize`)
4. Store vectors on DocumentChunk records
5. Update Document status to `READY`
6. Update KB `documentCount`

**Partial failure:** If embedding fails mid-batch, completed chunks keep their vectors. Job retries remaining chunks on next attempt.

### Pre-processing Details

| Step | Library/Service | Notes |
|------|----------------|-------|
| PDF text extraction | `pdf-parse` | Falls back to Textract for scanned PDFs |
| OCR | AWS Textract `DetectDocumentText` | Async API for large docs, sync for small |
| DOCX conversion | `mammoth` | DOCX → HTML → Markdown |
| XLSX parsing | `xlsx` (SheetJS) | Sheet → CSV → text or markdown tables |
| HTML stripping | `sanitize-html` or regex | Remove tags, preserve text structure |
| PII redaction | Custom regex engine | Email, phone, SSN, credit card patterns. Configurable per KB. Replaces with `[REDACTED]` |
| Table extraction | Textract `AnalyzeDocument` (PDF) / mammoth (DOCX) | Tables → markdown format |

### Chunking Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `FIXED_SIZE` | Split at exact character count with overlap | Simple text, logs |
| `RECURSIVE_CHARACTER` | Split by paragraphs → sentences → words, respecting boundaries | General-purpose text |
| `SEMANTIC` | Split at sentence boundaries using NLP sentence detection | Narrative content, articles |
| `MARKDOWN_AWARE` | Split by headings (h1 → h2 → h3), preserving heading hierarchy in metadata | Documentation, READMEs |
| `CODE_AWARE` | Split by functions/classes/blocks, language-detected | Source code, config files |

All strategies respect `chunkSize` (target token count) and `chunkOverlap` (overlap tokens between adjacent chunks).

---

## Embedding Provider Abstraction

### Interface

```typescript
interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;

  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### Implementations

| Provider | Model | Dimensions | Max Batch | Notes |
|----------|-------|-----------|-----------|-------|
| `BEDROCK_TITAN` | `amazon.titan-embed-text-v2:0` | 1024 | 25 | Existing setup in `libs/ai` |
| `OPENAI` | `text-embedding-3-small` / `text-embedding-3-large` | 1536 / 3072 | 100 | Via OpenAI API |
| `COHERE` | `embed-english-v3.0` | 1024 | 96 | Via Cohere API |
| `LOCAL` | Configurable (BGE, E5, Nomic) | Configurable | 32 | Via Ollama HTTP API |

### Factory

```typescript
EmbeddingProviderFactory.create(config: {
  provider: string;
  model: string;
  dimensions: number;
}): EmbeddingProvider
```

Reads API keys from environment variables:
- `OPENAI_API_KEY` for OpenAI
- `COHERE_API_KEY` for Cohere
- AWS credentials (existing) for Bedrock
- `OLLAMA_BASE_URL` for local models

---

## Retrieval System

### Search Modes

**Dense search (pgvector):**
- Embed query using KB's embedding provider
- Cosine similarity search via pgvector HNSW index
- Filter by similarity threshold
- Apply metadata filters via JSONB WHERE clause

**Sparse search (tsvector/BM25):**
- Convert query to tsquery
- Rank using `ts_rank_cd` (cover density ranking)
- Apply same metadata filters

**Hybrid search (RRF):**
- Run both dense and sparse searches
- Merge results via Reciprocal Rank Fusion:
  ```
  score(doc) = α * (1 / (k + rank_dense)) + (1-α) * (1 / (k + rank_sparse))
  ```
  where `k = 60` (standard RRF constant), `α = hybridAlpha` from config

### Reranking

After initial search, optionally rerank the top results:

| Provider | Implementation | Latency | Notes |
|----------|---------------|---------|-------|
| `COHERE` | Cohere Rerank API (`rerank-english-v3.0`) | ~200ms | Best quality, requires API key |
| `CROSS_ENCODER` | Local model via Ollama | ~500ms | No external dependency |
| `NONE` | Skip reranking | 0ms | Use initial search scores |

Reranking takes the top `topK * 2` results from search, reranks them, then returns the top `topK`.

### Contextual Compression

Optional LLM-based post-processing after reranking:
1. For each chunk, ask the LLM: "Is this chunk relevant to the query? If yes, extract only the relevant sentences."
2. Filter out irrelevant chunks
3. Return compressed chunks with only relevant content

Uses the tenant's configured Bedrock chat model to avoid adding another provider dependency.

### Service Interface

```typescript
class RetrievalService {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult[]>;
  searchMultiKB(query: string, kbIds: string[], options: Partial<RetrievalOptions>): Promise<RetrievalResult[]>;
  testRetrieval(query: string, kbId: string, options: Partial<RetrievalOptions>): Promise<DetailedRetrievalResult[]>;
}

interface RetrievalOptions {
  knowledgeBaseId: string;
  topK: number;                     // default: 10
  similarityThreshold: number;      // default: 0.7
  searchMode: 'DENSE' | 'SPARSE' | 'HYBRID';
  hybridAlpha: number;              // default: 0.7
  metadataFilters?: MetadataFilter[];
  rerankProvider?: 'COHERE' | 'CROSS_ENCODER' | 'NONE';
  rerankTopK?: number;
  useCompression?: boolean;
}

interface RetrievalResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  documentId: string;
  documentName: string;
}

interface DetailedRetrievalResult extends RetrievalResult {
  denseScore?: number;
  sparseScore?: number;
  rrfScore?: number;
  rerankScore?: number;
  compressionKept: boolean;
}

interface MetadataFilter {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'lt' | 'between';
  value: unknown;
}
```

---

## API Routes

All routes are tenant-scoped via existing middleware (`x-tenant-id` header injection).

### Knowledge Base CRUD

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/knowledge-base` | Create KB |
| `GET` | `/api/knowledge-base` | List KBs for tenant |
| `GET` | `/api/knowledge-base/[id]` | Get KB details + stats |
| `PATCH` | `/api/knowledge-base/[id]` | Update KB settings |
| `DELETE` | `/api/knowledge-base/[id]` | Delete KB + all data |

### Data Sources

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/knowledge-base/[id]/sources` | Add data source |
| `GET` | `/api/knowledge-base/[id]/sources` | List sources |
| `DELETE` | `/api/knowledge-base/[id]/sources/[sid]` | Remove source + documents |
| `POST` | `/api/knowledge-base/[id]/sources/[sid]/sync` | Trigger re-sync |

### Documents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/knowledge-base/[id]/documents` | List documents (paginated) |
| `GET` | `/api/knowledge-base/[id]/documents/[did]` | Document detail |
| `DELETE` | `/api/knowledge-base/[id]/documents/[did]` | Delete document + chunks |
| `POST` | `/api/knowledge-base/[id]/upload` | Get presigned S3 upload URL |

### Retrieval

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/knowledge-base/[id]/search` | Search single KB |
| `POST` | `/api/knowledge-base/search` | Search across multiple KBs |

### Testing

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/knowledge-base/[id]/test` | Detailed retrieval test |
| `GET` | `/api/knowledge-base/[id]/chunks` | Browse chunks (paginated) |
| `GET` | `/api/knowledge-base/[id]/chunks/embeddings` | UMAP 2D projections |

### Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/knowledge-base/[id]/stats` | Ingestion stats, distributions |

---

## Testing UI

### Page Structure

```
apps/web-ui/app/(dashboard)/knowledge-base/
  page.tsx                    → KB list (cards with stats, status badges)
  create/page.tsx             → Create KB wizard
  [id]/
    page.tsx                  → KB detail overview
    settings/page.tsx         → Edit KB config
    documents/page.tsx        → Document list + upload
    test/page.tsx             → Retrieval tester + chunk browser
    visualize/page.tsx        → UMAP embedding visualization
```

### Retrieval Tester

- Query input with real-time search
- Toggle search mode (dense / sparse / hybrid)
- Adjustable top-k and similarity threshold sliders
- Results show: chunk content, final score, per-stage scores (dense, sparse, RRF, rerank)
- Source document attribution with page/section metadata

### Chunk Browser

- Paginated list of all chunks in a KB
- Filter by document, metadata fields, token count range
- Expandable chunk cards showing full content + metadata
- Token count and chunk index display

### UMAP Visualization

- **Server-side:** `umap-js` projects embeddings to 2D coordinates. Cached per KB version (invalidated when chunks change). For KBs with >5000 chunks, uses representative sampling.
- **Client-side:** Canvas-based scatter plot with zoom, pan, hover tooltips. Color-coded by source document. Click to inspect chunk content.

---

## New Dependencies

| Package | Purpose | Used In |
|---------|---------|---------|
| `pdf-parse` | PDF text extraction | `libs/knowledge-base` |
| `mammoth` | DOCX → HTML conversion | `libs/knowledge-base` |
| `xlsx` | XLSX parsing | `libs/knowledge-base` |
| `sanitize-html` | HTML tag stripping | `libs/knowledge-base` |
| `umap-js` | UMAP dimensionality reduction | `libs/knowledge-base` |
| `openai` | OpenAI embeddings API | `libs/knowledge-base` |
| `cohere-ai` | Cohere embeddings + reranking | `libs/knowledge-base` |
| `@aws-sdk/client-textract` | OCR + table extraction | `libs/knowledge-base` |
| `@aws-sdk/client-s3` | File storage | `libs/knowledge-base` |
| `@aws-sdk/s3-request-presigner` | Presigned upload URLs | `libs/knowledge-base` |

---

## Environment Variables

### Required (for core functionality)

| Variable | Description |
|----------|-------------|
| `KB_S3_BUCKET` | S3 bucket for raw document storage |
| `AWS_REGION` | AWS region (existing, used for S3 + Textract) |

### Optional (per embedding/reranking provider)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (for OpenAI embeddings) |
| `COHERE_API_KEY` | Cohere API key (for Cohere embeddings + reranking) |
| `OLLAMA_BASE_URL` | Ollama server URL (for local embeddings + cross-encoder) |

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| KB ownership | Tenant-scoped | Matches existing multi-tenancy model |
| Raw file storage | S3 | Production-viable, enables re-processing |
| Processing pipeline | pg-boss async jobs | Reuses existing worker infrastructure |
| Chunking strategies | All 5 from PRD | User requested full coverage |
| Pre-processing | All 4 steps (HTML strip, PII, OCR, tables) | User requested full coverage |
| Embeddings | Multi-provider from day one | User preference over incremental approach |
| Retrieval | Full stack (dense, sparse, hybrid, rerank, compress) | User requested full PRD coverage |
| Testing UI | Full (tester, browser, UMAP) | User requested full PRD coverage |
| Module structure | New Nx library `libs/knowledge-base` | Clean separation, independent tests |
| Vector storage | pgvector with HNSW indexes | Already in stack, sufficient for core |
| Hybrid search | RRF merge + tsvector BM25 | PostgreSQL-native, no external search engine |
