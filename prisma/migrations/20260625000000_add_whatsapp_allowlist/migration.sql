-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "restrictToAllowlist" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "whatsapp_allowed_contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_allowed_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_allowed_contacts_accountId_idx" ON "whatsapp_allowed_contacts"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_allowed_contacts_accountId_phoneNumber_key" ON "whatsapp_allowed_contacts"("accountId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "whatsapp_allowed_contacts" ADD CONSTRAINT "whatsapp_allowed_contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
