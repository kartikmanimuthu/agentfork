-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "embeddingProvider" TEXT NOT NULL DEFAULT 'BEDROCK_TITAN',
    "embeddingModel" TEXT NOT NULL DEFAULT 'amazon.titan-embed-text-v2:0',
    "embeddingDimensions" INTEGER NOT NULL DEFAULT 1024,
    "chunkStrategy" TEXT NOT NULL DEFAULT 'RECURSIVE_CHARACTER',
    "chunkSize" INTEGER NOT NULL DEFAULT 512,
    "chunkOverlap" INTEGER NOT NULL DEFAULT 50,
    "preProcessing" JSONB NOT NULL DEFAULT '{"htmlStripping":true,"piiRedaction":false,"ocrEnabled":false,"tableExtraction":true}',
    "retrievalConfig" JSONB NOT NULL DEFAULT '{"topK":10,"similarityThreshold":0.7,"searchMode":"HYBRID","hybridAlpha":0.7,"rerankProvider":"NONE","useCompression":false}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt" TIMESTAMP(3),
    "syncSchedule" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "metadata" JSONB,
    "processedText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "metadata" JSONB,
    "searchText" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_bases_tenantId_idx" ON "knowledge_bases"("tenantId");

-- CreateIndex
CREATE INDEX "knowledge_bases_tenantId_status_idx" ON "knowledge_bases"("tenantId", "status");

-- CreateIndex
CREATE INDEX "data_sources_knowledgeBaseId_idx" ON "data_sources"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "documents_dataSourceId_idx" ON "documents"("dataSourceId");

-- CreateIndex
CREATE INDEX "documents_dataSourceId_status_idx" ON "documents"("dataSourceId", "status");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_chunkIndex_idx" ON "document_chunks"("documentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add vector column for embeddings (max 2000 dims for HNSW index compatibility)
ALTER TABLE document_chunks ADD COLUMN embedding vector(2000);

-- HNSW index for dense search
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- GIN index for sparse search
CREATE INDEX idx_document_chunks_search_text ON document_chunks USING gin ("searchText");

-- GIN index for metadata filtering
CREATE INDEX idx_document_chunks_metadata ON document_chunks USING gin (metadata jsonb_path_ops);
