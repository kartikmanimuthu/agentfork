-- CreateTable
CREATE TABLE "evaluators" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "score_config_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "max_tokens" INTEGER DEFAULT 4096,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_queues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "score_config_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "filters" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotation_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_queue_items" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "message_id" TEXT,
    "session_id" TEXT,
    "execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewer_user_id" TEXT,
    "score_id" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotation_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataset_id" TEXT NOT NULL,
    "agent_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score_config_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_run_items" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dataset_item_id" TEXT NOT NULL,
    "agent_version_id" TEXT NOT NULL,
    "inference_session_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "output_text" TEXT,
    "output_json" JSONB,
    "latency_ms" INTEGER,
    "token_usage" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluators_tenant_id_name_key" ON "evaluators"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "evaluators_tenant_id_idx" ON "evaluators"("tenant_id");

-- CreateIndex
CREATE INDEX "evaluators_tenant_id_is_active_idx" ON "evaluators"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "evaluators_score_config_id_idx" ON "evaluators"("score_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "annotation_queues_tenant_id_name_key" ON "annotation_queues"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "annotation_queues_tenant_id_idx" ON "annotation_queues"("tenant_id");

-- CreateIndex
CREATE INDEX "annotation_queues_tenant_id_is_active_idx" ON "annotation_queues"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "annotation_queues_score_config_id_idx" ON "annotation_queues"("score_config_id");

-- CreateIndex
CREATE INDEX "annotation_queue_items_queue_id_idx" ON "annotation_queue_items"("queue_id");

-- CreateIndex
CREATE INDEX "annotation_queue_items_queue_id_status_idx" ON "annotation_queue_items"("queue_id", "status");

-- CreateIndex
CREATE INDEX "annotation_queue_items_tenant_id_idx" ON "annotation_queue_items"("tenant_id");

-- CreateIndex
CREATE INDEX "annotation_queue_items_message_id_idx" ON "annotation_queue_items"("message_id");

-- CreateIndex
CREATE INDEX "annotation_queue_items_session_id_idx" ON "annotation_queue_items"("session_id");

-- CreateIndex
CREATE INDEX "annotation_queue_items_execution_id_idx" ON "annotation_queue_items"("execution_id");

-- CreateIndex
CREATE INDEX "experiments_tenant_id_idx" ON "experiments"("tenant_id");

-- CreateIndex
CREATE INDEX "experiments_tenant_id_status_idx" ON "experiments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "experiments_dataset_id_idx" ON "experiments"("dataset_id");

-- CreateIndex
CREATE INDEX "experiment_run_items_experiment_id_idx" ON "experiment_run_items"("experiment_id");

-- CreateIndex
CREATE INDEX "experiment_run_items_experiment_id_dataset_item_id_idx" ON "experiment_run_items"("experiment_id", "dataset_item_id");

-- CreateIndex
CREATE INDEX "experiment_run_items_experiment_id_agent_version_id_idx" ON "experiment_run_items"("experiment_id", "agent_version_id");

-- CreateIndex
CREATE INDEX "experiment_run_items_tenant_id_idx" ON "experiment_run_items"("tenant_id");

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_score_config_id_fkey" FOREIGN KEY ("score_config_id") REFERENCES "score_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queues" ADD CONSTRAINT "annotation_queues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queues" ADD CONSTRAINT "annotation_queues_score_config_id_fkey" FOREIGN KEY ("score_config_id") REFERENCES "score_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "annotation_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inference_session_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "api_key_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_queue_items" ADD CONSTRAINT "annotation_queue_items_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "scores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_dataset_item_id_fkey" FOREIGN KEY ("dataset_item_id") REFERENCES "dataset_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_run_items" ADD CONSTRAINT "experiment_run_items_inference_session_id_fkey" FOREIGN KEY ("inference_session_id") REFERENCES "inference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
