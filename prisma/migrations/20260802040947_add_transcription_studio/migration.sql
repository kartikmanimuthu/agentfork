-- NOTE: `prisma migrate dev` wanted to DROP INDEX "claw_memories_embedding_hnsw"
-- and "idx_document_chunks_embedding" here. Both are raw-SQL HNSW indexes on
-- Unsupported("vector(...)") columns, which Prisma cannot model and therefore
-- reports as drift. Dropping them would silently degrade memory recall and
-- knowledge-base search to sequential scans. Deliberately removed — see
-- 20260715055000_restore_document_chunks_embedding_index, which exists because
-- this happened once already.

-- CreateTable
CREATE TABLE "transcription_models" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "contract" TEXT NOT NULL DEFAULT 'custom',
    "endpointUrl" TEXT NOT NULL,
    "credentials" TEXT,
    "region" TEXT,
    "modelId" TEXT,
    "models" JSONB,
    "config" JSONB,
    "activeVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_model_versions" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL,
    "changeNotes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_job_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "modelId" TEXT,
    "versionId" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_job_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_job_versions" (
    "id" TEXT NOT NULL,
    "jobConfigId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL,
    "changeNotes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_job_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobConfigId" TEXT,
    "modelId" TEXT,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scopes" TEXT[] DEFAULT ARRAY['transcription:write']::TEXT[],
    "dailyReqLimit" INTEGER NOT NULL DEFAULT 1000,
    "dailyMinutesLimit" INTEGER NOT NULL DEFAULT 600,
    "minuteReqLimit" INTEGER NOT NULL DEFAULT 100,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_uploads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "declaredSizeBytes" INTEGER,
    "actualSizeBytes" INTEGER,
    "clientReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcription_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_jobs" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "jobConfigId" TEXT,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT,
    "providerVersionId" TEXT,
    "source" TEXT NOT NULL,
    "uploadId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "s3Bucket" TEXT,
    "s3Key" TEXT,
    "inputS3Key" TEXT,
    "outputS3Key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transcript" TEXT,
    "language" TEXT,
    "output" JSONB,
    "error" TEXT,
    "latencyMs" INTEGER,
    "webhookUrl" TEXT,
    "webhookStatus" TEXT,
    "webhookDeliveredAt" TIMESTAMP(3),
    "webhookAttempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcription_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_api_key_usage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "minutesCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minuteReqCount" INTEGER NOT NULL DEFAULT 0,
    "minuteResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcription_aws_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "region" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_aws_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transcription_models_tenantId_idx" ON "transcription_models"("tenantId");

-- CreateIndex
CREATE INDEX "transcription_models_tenantId_isDefault_idx" ON "transcription_models"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_models_tenantId_name_key" ON "transcription_models"("tenantId", "name");

-- CreateIndex
CREATE INDEX "transcription_model_versions_modelId_idx" ON "transcription_model_versions"("modelId");

-- CreateIndex
CREATE INDEX "transcription_model_versions_modelId_status_idx" ON "transcription_model_versions"("modelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_model_versions_modelId_version_key" ON "transcription_model_versions"("modelId", "version");

-- CreateIndex
CREATE INDEX "transcription_job_configs_tenantId_idx" ON "transcription_job_configs"("tenantId");

-- CreateIndex
CREATE INDEX "transcription_job_configs_tenantId_status_idx" ON "transcription_job_configs"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_job_configs_tenantId_name_key" ON "transcription_job_configs"("tenantId", "name");

-- CreateIndex
CREATE INDEX "transcription_job_versions_jobConfigId_idx" ON "transcription_job_versions"("jobConfigId");

-- CreateIndex
CREATE INDEX "transcription_job_versions_jobConfigId_status_idx" ON "transcription_job_versions"("jobConfigId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_job_versions_jobConfigId_version_key" ON "transcription_job_versions"("jobConfigId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_api_keys_keyHash_key" ON "transcription_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "transcription_api_keys_keyHash_idx" ON "transcription_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "transcription_api_keys_tenantId_status_idx" ON "transcription_api_keys"("tenantId", "status");

-- CreateIndex
CREATE INDEX "transcription_api_keys_jobConfigId_status_idx" ON "transcription_api_keys"("jobConfigId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_uploads_s3Key_key" ON "transcription_uploads"("s3Key");

-- CreateIndex
CREATE INDEX "transcription_uploads_tenantId_createdAt_idx" ON "transcription_uploads"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "transcription_uploads_tenantId_clientReference_idx" ON "transcription_uploads"("tenantId", "clientReference");

-- CreateIndex
CREATE INDEX "transcription_uploads_status_expiresAt_idx" ON "transcription_uploads"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "transcription_jobs_apiKeyId_createdAt_idx" ON "transcription_jobs"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "transcription_jobs_jobConfigId_createdAt_idx" ON "transcription_jobs"("jobConfigId", "createdAt");

-- CreateIndex
CREATE INDEX "transcription_jobs_tenantId_createdAt_idx" ON "transcription_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "transcription_jobs_status_idx" ON "transcription_jobs"("status");

-- CreateIndex
CREATE INDEX "transcription_jobs_tenantId_uploadId_idx" ON "transcription_jobs"("tenantId", "uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_jobs_uploadId_key" ON "transcription_jobs"("uploadId");

-- CreateIndex
CREATE INDEX "transcription_api_key_usage_apiKeyId_date_idx" ON "transcription_api_key_usage"("apiKeyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_api_key_usage_apiKeyId_date_key" ON "transcription_api_key_usage"("apiKeyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_aws_credentials_tenantId_key" ON "transcription_aws_credentials"("tenantId");

-- AddForeignKey
ALTER TABLE "transcription_models" ADD CONSTRAINT "transcription_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_model_versions" ADD CONSTRAINT "transcription_model_versions_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "transcription_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_job_configs" ADD CONSTRAINT "transcription_job_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_job_configs" ADD CONSTRAINT "transcription_job_configs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "transcription_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_job_configs" ADD CONSTRAINT "transcription_job_configs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "transcription_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_job_versions" ADD CONSTRAINT "transcription_job_versions_jobConfigId_fkey" FOREIGN KEY ("jobConfigId") REFERENCES "transcription_job_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_api_keys" ADD CONSTRAINT "transcription_api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_api_keys" ADD CONSTRAINT "transcription_api_keys_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "transcription_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_api_keys" ADD CONSTRAINT "transcription_api_keys_jobConfigId_fkey" FOREIGN KEY ("jobConfigId") REFERENCES "transcription_job_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_uploads" ADD CONSTRAINT "transcription_uploads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_uploads" ADD CONSTRAINT "transcription_uploads_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "transcription_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "transcription_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_jobConfigId_fkey" FOREIGN KEY ("jobConfigId") REFERENCES "transcription_job_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "transcription_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_providerVersionId_fkey" FOREIGN KEY ("providerVersionId") REFERENCES "transcription_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "transcription_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_api_key_usage" ADD CONSTRAINT "transcription_api_key_usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "transcription_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcription_aws_credentials" ADD CONSTRAINT "transcription_aws_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
