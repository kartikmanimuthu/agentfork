-- CreateTable
CREATE TABLE "claw_scheduled_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clawId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'cron',
    "cronExpression" TEXT NOT NULL DEFAULT '',
    "intervalMinutes" INTEGER,
    "runAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "approvalMode" TEXT NOT NULL DEFAULT 'ask',
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sessionMode" TEXT NOT NULL DEFAULT 'isolated',
    "maxIterations" INTEGER,
    "providerModelId" TEXT,
    "delivery" JSONB NOT NULL DEFAULT '{}',
    "lastRunId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failureStreak" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claw_scheduled_task_locks" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "scheduledAt" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_scheduled_task_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_scheduled_tasks_taskId_key" ON "claw_scheduled_tasks"("taskId");

-- CreateIndex
CREATE INDEX "claw_scheduled_tasks_tenantId_idx" ON "claw_scheduled_tasks"("tenantId");

-- CreateIndex
CREATE INDEX "claw_scheduled_tasks_status_idx" ON "claw_scheduled_tasks"("status");

-- CreateIndex
CREATE INDEX "claw_scheduled_tasks_tenantId_status_idx" ON "claw_scheduled_tasks"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "claw_scheduled_task_locks_taskId_scheduledAt_key" ON "claw_scheduled_task_locks"("taskId", "scheduledAt");

-- CreateIndex
CREATE INDEX "claw_scheduled_task_locks_expiresAt_idx" ON "claw_scheduled_task_locks"("expiresAt");

-- AddForeignKey
ALTER TABLE "claw_scheduled_tasks" ADD CONSTRAINT "claw_scheduled_tasks_clawId_fkey" FOREIGN KEY ("clawId") REFERENCES "claws"("id") ON DELETE CASCADE ON UPDATE CASCADE;
