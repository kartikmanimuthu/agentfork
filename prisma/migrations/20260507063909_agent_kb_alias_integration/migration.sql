/*
  Warnings:

  - You are about to drop the column `embedding` on the `document_chunks` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "idx_document_chunks_embedding";

-- DropIndex
DROP INDEX "idx_document_chunks_metadata";

-- DropIndex
DROP INDEX "idx_document_chunks_search_text";

-- AlterTable
ALTER TABLE "document_chunks" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "chatModel" TEXT,
    "embeddingModel" TEXT,
    "embeddingDimensions" INTEGER,
    "baseUrl" TEXT,
    "apiKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'simple',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playground_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT,
    "name" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "configOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playground_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transport" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_versions" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "changeNotes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_server_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_mcp_servers" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_knowledge_bases" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_aliases" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scopes" TEXT[] DEFAULT ARRAY['inference:read']::TEXT[],
    "dailyReqLimit" INTEGER NOT NULL DEFAULT 1000,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 100000,
    "minuteReqLimit" INTEGER NOT NULL DEFAULT 100,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "minuteReqCount" INTEGER NOT NULL DEFAULT 0,
    "minuteResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_executions" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "tokenUsage" JSONB,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "webhookUrl" TEXT,
    "webhookStatus" TEXT,
    "webhookDeliveredAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inference_sessions" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT,
    "messages" JSONB NOT NULL,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inference_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_response_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "metadata" JSONB,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_response_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_providers_tenantId_idx" ON "llm_providers"("tenantId");

-- CreateIndex
CREATE INDEX "llm_providers_tenantId_isDefault_idx" ON "llm_providers"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "llm_providers_tenantId_name_key" ON "llm_providers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_email_idx" ON "password_reset_tokens"("email");

-- CreateIndex
CREATE INDEX "agents_tenantId_idx" ON "agents"("tenantId");

-- CreateIndex
CREATE INDEX "agents_tenantId_status_idx" ON "agents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "agents_tenantId_type_idx" ON "agents"("tenantId", "type");

-- CreateIndex
CREATE INDEX "agents_tenantId_updatedAt_idx" ON "agents"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "agent_versions_agentId_idx" ON "agent_versions"("agentId");

-- CreateIndex
CREATE INDEX "agent_versions_agentId_status_idx" ON "agent_versions"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agentId_version_key" ON "agent_versions"("agentId", "version");

-- CreateIndex
CREATE INDEX "agent_executions_agentId_idx" ON "agent_executions"("agentId");

-- CreateIndex
CREATE INDEX "agent_executions_agentVersionId_idx" ON "agent_executions"("agentVersionId");

-- CreateIndex
CREATE INDEX "agent_executions_tenantId_idx" ON "agent_executions"("tenantId");

-- CreateIndex
CREATE INDEX "agent_executions_tenantId_userId_idx" ON "agent_executions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "agent_executions_tenantId_status_idx" ON "agent_executions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "playground_sessions_tenantId_idx" ON "playground_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "playground_sessions_tenantId_userId_idx" ON "playground_sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "playground_sessions_agentId_idx" ON "playground_sessions"("agentId");

-- CreateIndex
CREATE INDEX "playground_sessions_agentId_agentVersionId_idx" ON "playground_sessions"("agentId", "agentVersionId");

-- CreateIndex
CREATE INDEX "mcp_servers_tenantId_idx" ON "mcp_servers"("tenantId");

-- CreateIndex
CREATE INDEX "mcp_servers_tenantId_status_idx" ON "mcp_servers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_tenantId_name_key" ON "mcp_servers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "mcp_server_versions_mcpServerId_idx" ON "mcp_server_versions"("mcpServerId");

-- CreateIndex
CREATE INDEX "mcp_server_versions_mcpServerId_createdAt_idx" ON "mcp_server_versions"("mcpServerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_versions_mcpServerId_version_key" ON "mcp_server_versions"("mcpServerId", "version");

-- CreateIndex
CREATE INDEX "agent_mcp_servers_agentId_idx" ON "agent_mcp_servers"("agentId");

-- CreateIndex
CREATE INDEX "agent_mcp_servers_mcpServerId_idx" ON "agent_mcp_servers"("mcpServerId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_mcp_servers_agentId_mcpServerId_key" ON "agent_mcp_servers"("agentId", "mcpServerId");

-- CreateIndex
CREATE INDEX "agent_knowledge_bases_agentId_idx" ON "agent_knowledge_bases"("agentId");

-- CreateIndex
CREATE INDEX "agent_knowledge_bases_knowledgeBaseId_idx" ON "agent_knowledge_bases"("knowledgeBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_knowledge_bases_agentId_knowledgeBaseId_key" ON "agent_knowledge_bases"("agentId", "knowledgeBaseId");

-- CreateIndex
CREATE INDEX "agent_aliases_agentId_idx" ON "agent_aliases"("agentId");

-- CreateIndex
CREATE INDEX "agent_aliases_versionId_idx" ON "agent_aliases"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_aliases_agentId_name_key" ON "agent_aliases"("agentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_agentId_status_idx" ON "api_keys"("tenantId", "agentId", "status");

-- CreateIndex
CREATE INDEX "api_key_usage_apiKeyId_date_idx" ON "api_key_usage"("apiKeyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_usage_apiKeyId_date_key" ON "api_key_usage"("apiKeyId", "date");

-- CreateIndex
CREATE INDEX "api_key_executions_apiKeyId_createdAt_idx" ON "api_key_executions"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "api_key_executions_tenantId_createdAt_idx" ON "api_key_executions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "api_key_executions_status_idx" ON "api_key_executions"("status");

-- CreateIndex
CREATE INDEX "inference_sessions_apiKeyId_idx" ON "inference_sessions"("apiKeyId");

-- CreateIndex
CREATE INDEX "inference_sessions_tenantId_agentId_idx" ON "inference_sessions"("tenantId", "agentId");

-- CreateIndex
CREATE INDEX "inference_sessions_expiresAt_idx" ON "inference_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "llm_response_cache_cacheKey_key" ON "llm_response_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "llm_response_cache_cacheKey_idx" ON "llm_response_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "llm_response_cache_expiresAt_idx" ON "llm_response_cache"("expiresAt");

-- AddForeignKey
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playground_sessions" ADD CONSTRAINT "playground_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playground_sessions" ADD CONSTRAINT "playground_sessions_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playground_sessions" ADD CONSTRAINT "playground_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_versions" ADD CONSTRAINT "mcp_server_versions_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_aliases" ADD CONSTRAINT "agent_aliases_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_aliases" ADD CONSTRAINT "agent_aliases_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_executions" ADD CONSTRAINT "api_key_executions_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inference_sessions" ADD CONSTRAINT "inference_sessions_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inference_sessions" ADD CONSTRAINT "inference_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
