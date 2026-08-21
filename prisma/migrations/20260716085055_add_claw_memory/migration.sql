-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('SEMANTIC', 'EPISODIC', 'PROCEDURAL');

-- CreateTable
CREATE TABLE "claw_memories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "kind" "MemoryKind" NOT NULL DEFAULT 'SEMANTIC',
    "embedding" vector(1024),
    "sourceThreadId" TEXT,
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_working_memory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "runningSummary" TEXT NOT NULL,
    "scratchpad" JSONB NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_working_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claw_memories_tenantId_namespace_key_idx" ON "claw_memories"("tenantId", "namespace", "key");

-- CreateIndex
CREATE INDEX "claw_memories_tenantId_userId_idx" ON "claw_memories"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "claw_memories_tenantId_kind_idx" ON "claw_memories"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "claw_memories_expiresAt_idx" ON "claw_memories"("expiresAt");

-- CreateIndex
CREATE INDEX "claw_working_memory_expiresAt_idx" ON "claw_working_memory"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "claw_working_memory_tenantId_threadId_key" ON "claw_working_memory"("tenantId", "threadId");

-- pgvector column (Prisma leaves Unsupported columns out or as bytea on some diff paths)
ALTER TABLE "claw_memories" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

-- HNSW cosine index for similarity search
CREATE INDEX IF NOT EXISTS "claw_memories_embedding_hnsw" ON "claw_memories" USING hnsw ("embedding" vector_cosine_ops);

-- partial unique index: only LIVE (non-superseded) rows are unique per (tenant, namespace, key)
CREATE UNIQUE INDEX IF NOT EXISTS "claw_memories_live_tenant_ns_key" ON "claw_memories" ("tenantId","namespace","key") WHERE "supersededById" IS NULL;

-- restore the KB HNSW index: Prisma's diff engine cannot see raw-SQL indexes on
-- Unsupported("vector(...)") columns, so it emitted a spurious DROP INDEX for this
-- migration (same root cause as the three prior "restore_document_chunks_embedding_index"
-- migrations in this repo). Recreate it here so it survives this migration.
CREATE INDEX IF NOT EXISTS "idx_document_chunks_embedding"
  ON "document_chunks" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
