-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN "agentId" TEXT;

-- CreateIndex
CREATE INDEX "whatsapp_accounts_agentId_idx" ON "whatsapp_accounts"("agentId");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
