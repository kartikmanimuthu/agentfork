/*
  Warnings:

  - You are about to drop the column `apiKey` on the `llm_providers` table. All the data in the column will be lost.
  - You are about to drop the column `baseUrl` on the `llm_providers` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `llm_providers` table. All the data in the column will be lost.
  - Added the required column `providerType` to the `llm_providers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "llm_providers" DROP COLUMN "apiKey",
DROP COLUMN "baseUrl",
DROP COLUMN "provider",
ADD COLUMN     "credentials" TEXT,
ADD COLUMN     "models" JSONB,
ADD COLUMN     "providerType" TEXT NOT NULL,
ADD COLUMN     "region" TEXT;
