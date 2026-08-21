-- Channel connector gateway: runs, run events, and the platform-id -> tenant
-- reverse lookup. Purely additive.
--
-- NOTE: prisma migrate diff also emitted DROP INDEX for claw_memories_embedding_hnsw
-- and idx_document_chunks_embedding. Those are raw-SQL pgvector HNSW indexes on
-- Unsupported() columns, invisible to the Prisma schema — dropping them would
-- silently degrade vector search to sequential scans. Removed deliberately.

-- CreateTable
CREATE TABLE "claw_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "taskDescription" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "result" JSONB,
    "clarification" JSONB,
    "approvalRequest" JSONB,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_run_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "node" TEXT,
    "content" TEXT,
    "toolName" TEXT,
    "toolArgs" JSONB,
    "toolOutput" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_channel_links" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_channel_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_runs_runId_key" ON "claw_runs"("runId");

-- CreateIndex
CREATE INDEX "claw_runs_tenantId_status_idx" ON "claw_runs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "claw_runs_tenantId_createdAt_idx" ON "claw_runs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "claw_runs_threadId_idx" ON "claw_runs"("threadId");

-- CreateIndex
CREATE INDEX "claw_runs_expiresAt_idx" ON "claw_runs"("expiresAt");

-- CreateIndex
CREATE INDEX "claw_run_events_runId_createdAt_idx" ON "claw_run_events"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "claw_run_events_tenantId_idx" ON "claw_run_events"("tenantId");

-- CreateIndex
CREATE INDEX "claw_run_events_expiresAt_idx" ON "claw_run_events"("expiresAt");

-- CreateIndex
CREATE INDEX "claw_channel_links_tenantId_idx" ON "claw_channel_links"("tenantId");

-- CreateIndex
CREATE INDEX "claw_channel_links_tenantId_channel_idx" ON "claw_channel_links"("tenantId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "claw_channel_links_channel_externalId_key" ON "claw_channel_links"("channel", "externalId");

-- AddForeignKey
ALTER TABLE "claw_run_events" ADD CONSTRAINT "claw_run_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "claw_runs"("runId") ON DELETE CASCADE ON UPDATE CASCADE;

