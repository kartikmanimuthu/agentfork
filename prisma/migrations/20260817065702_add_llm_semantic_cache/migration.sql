-- CreateTable
CREATE TABLE "llm_semantic_cache" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "embedding" vector,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDims" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_semantic_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_semantic_cache_scopeKey_expiresAt_idx" ON "llm_semantic_cache"("scopeKey", "expiresAt");
