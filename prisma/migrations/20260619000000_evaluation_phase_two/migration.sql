-- CreateTable
CREATE TABLE "score_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataType" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "categories" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "messageId" TEXT,
    "sessionId" TEXT,
    "executionId" TEXT,
    "numericValue" DOUBLE PRECISION,
    "stringValue" TEXT,
    "comment" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ANNOTATION',
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluators" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scoreConfigId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "maxTokens" INTEGER DEFAULT 4096,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_queues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scoreConfigId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "filters" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotation_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_queue_items" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "messageId" TEXT,
    "sessionId" TEXT,
    "executionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerUserId" TEXT,
    "scoreId" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotation_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "datasetId" TEXT NOT NULL,
    "agentVersionIds" TEXT[],
    "scoreConfigIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_run_items" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "datasetItemId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "inferenceSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputText" TEXT,
    "outputJson" JSONB,
    "latencyMs" INTEGER,
    "tokenUsage" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_items" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expectedOutput" JSONB,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceMessageId" TEXT,
    "sourceSessionId" TEXT,
    "sourceExecutionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vizType" TEXT NOT NULL,
    "querySpec" JSONB NOT NULL,
    "layout" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "score_configs_tenantId_idx" ON "score_configs"("tenantId");

-- CreateIndex
CREATE INDEX "score_configs_tenantId_isArchived_idx" ON "score_configs"("tenantId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "score_configs_tenantId_name_key" ON "score_configs"("tenantId", "name");

-- CreateIndex
CREATE INDEX "scores_tenantId_idx" ON "scores"("tenantId");

-- CreateIndex
CREATE INDEX "scores_messageId_idx" ON "scores"("messageId");

-- CreateIndex
CREATE INDEX "scores_sessionId_idx" ON "scores"("sessionId");

-- CreateIndex
CREATE INDEX "scores_executionId_idx" ON "scores"("executionId");

-- CreateIndex
CREATE INDEX "scores_configId_idx" ON "scores"("configId");

-- CreateIndex
CREATE INDEX "scores_tenantId_source_idx" ON "scores"("tenantId", "source");

-- CreateIndex
CREATE INDEX "evaluators_tenantId_idx" ON "evaluators"("tenantId");

-- CreateIndex
CREATE INDEX "evaluators_tenantId_isActive_idx" ON "evaluators"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "evaluators_scoreConfigId_idx" ON "evaluators"("scoreConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluators_tenantId_name_key" ON "evaluators"("tenantId", "name");

-- CreateIndex
CREATE INDEX "annotation_queues_tenantId_idx" ON "annotation_queues"("tenantId");

-- CreateIndex
CREATE INDEX "annotation_queues_tenantId_isActive_idx" ON "annotation_queues"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "annotation_queues_scoreConfigId_idx" ON "annotation_queues"("scoreConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "annotation_queues_tenantId_name_key" ON "annotation_queues"("tenantId", "name");

-- CreateIndex
CREATE INDEX "annotation_queue_items_queueId_idx" ON "annotation_queue_items"("queueId");

-- CreateIndex
CREATE INDEX "annotation_queue_items_queueId_status_idx" ON "annotation_queue_items"("queueId", "status");

-- CreateIndex
CREATE INDEX "annotation_queue_items_tenantId_idx" ON "annotation_queue_items"("tenantId");

-- CreateIndex
CREATE INDEX "annotation_queue_items_messageId_idx" ON "annotation_queue_items"("messageId");

-- CreateIndex
CREATE INDEX "annotation_queue_items_sessionId_idx" ON "annotation_queue_items"("sessionId");

-- CreateIndex
CREATE INDEX "annotation_queue_items_executionId_idx" ON "annotation_queue_items"("executionId");

-- CreateIndex
CREATE INDEX "experiments_tenantId_idx" ON "experiments"("tenantId");

-- CreateIndex
CREATE INDEX "experiments_tenantId_status_idx" ON "experiments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "experiments_datasetId_idx" ON "experiments"("datasetId");

-- CreateIndex
CREATE INDEX "experiment_run_items_experimentId_idx" ON "experiment_run_items"("experimentId");

-- CreateIndex
CREATE INDEX "experiment_run_items_experimentId_datasetItemId_idx" ON "experiment_run_items"("experimentId", "datasetItemId");

-- CreateIndex
CREATE INDEX "experiment_run_items_experimentId_agentVersionId_idx" ON "experiment_run_items"("experimentId", "agentVersionId");

-- CreateIndex
CREATE INDEX "experiment_run_items_tenantId_idx" ON "experiment_run_items"("tenantId");

-- CreateIndex
CREATE INDEX "datasets_tenantId_idx" ON "datasets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_tenantId_name_key" ON "datasets"("tenantId", "name");

-- CreateIndex
CREATE INDEX "dataset_items_datasetId_idx" ON "dataset_items"("datasetId");

-- CreateIndex
CREATE INDEX "dataset_items_datasetId_status_idx" ON "dataset_items"("datasetId", "status");

-- CreateIndex
CREATE INDEX "dashboards_tenantId_idx" ON "dashboards"("tenantId");

-- CreateIndex
CREATE INDEX "dashboard_widgets_dashboardId_idx" ON "dashboard_widgets"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_widgets_tenantId_idx" ON "dashboard_widgets"("tenantId");

-- AddForeignKey
ALTER TABLE "score_configs" ADD CONSTRAINT "score_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_configId_fkey" FOREIGN KEY ("configId") REFERENCES "score_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "inference_session_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "api_key_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_scoreConfigId_fkey" FOREIGN KEY ("scoreConfigId") REFERENCES "score_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queues" ADD CONSTRAINT "annotation_queues_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queues" ADD CONSTRAINT "annotation_queues_scoreConfigId_fkey" FOREIGN KEY ("scoreConfigId") REFERENCES "score_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "annotation_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "inference_session_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "api_key_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "scores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_datasetItemId_fkey" FOREIGN KEY ("datasetItemId") REFERENCES "dataset_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_inferenceSessionId_fkey" FOREIGN KEY ("inferenceSessionId") REFERENCES "inference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_items" ADD CONSTRAINT "dataset_items_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

