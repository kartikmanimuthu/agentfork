-- DropIndex
DROP INDEX "idx_document_chunks_embedding";

-- CreateTable
CREATE TABLE "claw_studios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_studios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claws" (
    "id" TEXT NOT NULL,
    "clawStudioId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Claw',
    "systemPrompt" TEXT,
    "providerModelId" TEXT,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_conversations" (
    "id" TEXT NOT NULL,
    "clawId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_studios_studioId_key" ON "claw_studios"("studioId");

-- CreateIndex
CREATE INDEX "claw_studios_tenantId_idx" ON "claw_studios"("tenantId");

-- CreateIndex
CREATE INDEX "claws_clawStudioId_idx" ON "claws"("clawStudioId");

-- CreateIndex
CREATE UNIQUE INDEX "claw_conversations_threadId_key" ON "claw_conversations"("threadId");

-- CreateIndex
CREATE INDEX "claw_conversations_clawId_idx" ON "claw_conversations"("clawId");

-- AddForeignKey
ALTER TABLE "claw_studios" ADD CONSTRAINT "claw_studios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claws" ADD CONSTRAINT "claws_clawStudioId_fkey" FOREIGN KEY ("clawStudioId") REFERENCES "claw_studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claw_conversations" ADD CONSTRAINT "claw_conversations_clawId_fkey" FOREIGN KEY ("clawId") REFERENCES "claws"("id") ON DELETE CASCADE ON UPDATE CASCADE;
