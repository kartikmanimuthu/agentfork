-- CreateTable
CREATE TABLE "paused_executions" (
    "id" TEXT NOT NULL,
    "resumeToken" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "graphState" JSONB NOT NULL,
    "prompt" TEXT NOT NULL,
    "outputChannel" TEXT NOT NULL,
    "nextNodeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paused_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paused_executions_resumeToken_key" ON "paused_executions"("resumeToken");

-- CreateIndex
CREATE INDEX "paused_executions_tenantId_idx" ON "paused_executions"("tenantId");

-- CreateIndex
CREATE INDEX "paused_executions_resumeToken_idx" ON "paused_executions"("resumeToken");

-- CreateIndex
CREATE INDEX "paused_executions_expiresAt_idx" ON "paused_executions"("expiresAt");

-- CreateIndex
CREATE INDEX "paused_executions_executionId_idx" ON "paused_executions"("executionId");
