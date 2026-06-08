-- DropIndex
DROP INDEX "idx_document_chunks_embedding";

-- DropIndex
DROP INDEX "paused_executions_resumeToken_idx";

-- AlterTable
ALTER TABLE "inference_session_messages" ALTER COLUMN "attachments" SET DEFAULT '[]';

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhone" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "qualityRating" TEXT,
    "messagingLimit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_routing" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "fallbackAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_routing_rules" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "whatsapp_routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "agentId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "context" JSONB NOT NULL DEFAULT '{}',
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "windowExpiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT,
    "waMessageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "statusTimestamp" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botName" TEXT,
    "botUsername" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "agentId" TEXT,
    "triggerNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "contactName" TEXT,
    "agentId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "context" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT,
    "telegramMessageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "fromId" TEXT,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "statusTimestamp" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phoneNumberId_key" ON "whatsapp_accounts"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_tenantId_idx" ON "whatsapp_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenantId_wabaId_key" ON "whatsapp_accounts"("tenantId", "wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_routing_accountId_key" ON "whatsapp_routing"("accountId");

-- CreateIndex
CREATE INDEX "whatsapp_routing_rules_routingId_priority_idx" ON "whatsapp_routing_rules"("routingId", "priority");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_accountId_contactPhone_idx" ON "whatsapp_sessions"("accountId", "contactPhone");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_windowExpiresAt_idx" ON "whatsapp_sessions"("windowExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_accountId_contactPhone_state_key" ON "whatsapp_sessions"("accountId", "contactPhone", "state");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_waMessageId_key" ON "whatsapp_messages"("waMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_accountId_contactPhone_createdAt_idx" ON "whatsapp_messages"("accountId", "contactPhone", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_messages_sessionId_createdAt_idx" ON "whatsapp_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_accountId_name_language_key" ON "whatsapp_templates"("accountId", "name", "language");

-- CreateIndex
CREATE INDEX "telegram_accounts_tenantId_idx" ON "telegram_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "telegram_accounts_agentId_idx" ON "telegram_accounts"("agentId");

-- CreateIndex
CREATE INDEX "telegram_sessions_accountId_chatId_idx" ON "telegram_sessions"("accountId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_sessions_accountId_chatId_state_key" ON "telegram_sessions"("accountId", "chatId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_messages_telegramMessageId_key" ON "telegram_messages"("telegramMessageId");

-- CreateIndex
CREATE INDEX "telegram_messages_accountId_chatId_createdAt_idx" ON "telegram_messages"("accountId", "chatId", "createdAt");

-- CreateIndex
CREATE INDEX "telegram_messages_sessionId_createdAt_idx" ON "telegram_messages"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_routing" ADD CONSTRAINT "whatsapp_routing_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_routing_rules" ADD CONSTRAINT "whatsapp_routing_rules_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "whatsapp_routing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "whatsapp_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_sessions" ADD CONSTRAINT "telegram_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "telegram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "telegram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "telegram_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
