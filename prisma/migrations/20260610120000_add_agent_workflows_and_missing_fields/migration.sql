-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "showThinking" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "inference_session_messages" ADD COLUMN     "parts" JSONB;

-- AlterTable
ALTER TABLE "inference_sessions" ADD COLUMN     "workflowState" JSONB;

-- CreateTable
CREATE TABLE "agent_workflows" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_workflows_agentId_idx" ON "agent_workflows"("agentId");

-- CreateIndex
CREATE INDEX "agent_workflows_agentId_isActive_idx" ON "agent_workflows"("agentId", "isActive");

-- CreateIndex
CREATE INDEX "agent_workflows_tenantId_idx" ON "agent_workflows"("tenantId");

-- AddForeignKey
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
