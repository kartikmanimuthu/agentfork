-- CreateTable
CREATE TABLE "claw_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clawId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_file_revisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "reason" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claw_file_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claw_files_tenantId_idx" ON "claw_files"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "claw_files_clawId_slug_key" ON "claw_files"("clawId", "slug");

-- CreateIndex
CREATE INDEX "claw_file_revisions_tenantId_idx" ON "claw_file_revisions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "claw_file_revisions_fileId_version_key" ON "claw_file_revisions"("fileId", "version");

-- AddForeignKey
ALTER TABLE "claw_files" ADD CONSTRAINT "claw_files_clawId_fkey" FOREIGN KEY ("clawId") REFERENCES "claws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claw_file_revisions" ADD CONSTRAINT "claw_file_revisions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "claw_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
