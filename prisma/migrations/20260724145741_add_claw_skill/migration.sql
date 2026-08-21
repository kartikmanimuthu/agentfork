-- CreateTable
CREATE TABLE "claw_skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claw_skills_tenantId_idx" ON "claw_skills"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "claw_skills_tenantId_slug_key" ON "claw_skills"("tenantId", "slug");
