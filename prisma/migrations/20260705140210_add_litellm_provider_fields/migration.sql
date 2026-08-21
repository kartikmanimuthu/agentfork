-- AlterTable
ALTER TABLE "llm_providers" ADD COLUMN     "externalKeyAlias" TEXT,
ADD COLUMN     "maxBudgetUsd" DOUBLE PRECISION;
